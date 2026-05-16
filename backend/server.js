const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 1. DATABASE CONFIGURATION
// ==========================================
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'mama_ticket',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================
const generatePNR = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let pnr = 'MAMA-';
    for (let i = 0; i < 6; i++) pnr += chars.charAt(Math.floor(Math.random() * chars.length));
    return pnr;
};

// ==========================================
// 3. API ROUTES & CONTROLLERS
// ==========================================

/**
 * @route GET /api/stations
 * @desc Get all available stations
 */
app.get('/api/stations', async (req, res) => {
    try {
        const [stations] = await pool.query('SELECT * FROM stations ORDER BY name ASC');
        res.json({ success: true, count: stations.length, data: stations });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @route GET /api/trains/search
 * @desc Search trains dynamically between any two intermediate stations
 * @query source (Station ID), dest (Station ID), date (YYYY-MM-DD)
 */
app.get('/api/trains/search', async (req, res) => {
    const { source, dest, date } = req.query;

    if (!source || !dest || !date) {
        return res.status(400).json({ success: false, message: 'Source, destination, and date are required.' });
    }

    if (source === dest) {
        return res.status(400).json({ success: false, message: 'Source and destination cannot be the same.' });
    }

    try {
        // Core Logic: Find trains that stop at both stations, where source comes BEFORE dest.
        const query = `
            SELECT 
                t.id AS train_id, t.name AS train_name, t.train_number,
                sch.id AS schedule_id, sch.journey_date,
                src_stop.id AS source_stop_id, src_stop.stop_order AS source_order, 
                src_stop.departure_time AS source_departure,
                dest_stop.id AS dest_stop_id, dest_stop.stop_order AS dest_order, 
                dest_stop.arrival_time AS dest_arrival,
                (dest_stop.distance_from_start - src_stop.distance_from_start) AS travel_distance
            FROM trains t
            JOIN schedules sch ON t.id = sch.train_id
            JOIN train_stops src_stop ON t.id = src_stop.train_id
            JOIN train_stops dest_stop ON t.id = dest_stop.train_id
            WHERE sch.journey_date = ? 
              AND src_stop.station_id = ? 
              AND dest_stop.station_id = ? 
              AND src_stop.stop_order < dest_stop.stop_order
              AND t.status = 'ACTIVE'
        `;

        const [trains] = await pool.query(query, [date, source, dest]);

        if (trains.length === 0) {
            return res.status(404).json({ success: false, message: 'No train routes found for this selection.' });
        }

        // Calculate Seat Availability & Fares for each train found
        for (let train of trains) {
            const [classes] = await pool.query(`
                SELECT sc.id as class_id, sc.name as class_name, ts.total_seats, 
                       (sc.price_per_km * ?) as fare
                FROM train_seats ts
                JOIN seat_classes sc ON ts.seat_class_id = sc.id
                WHERE ts.train_id = ?
            `, [train.travel_distance, train.train_id]);

            const availableClasses = [];

            for (let c of classes) {
                // Determine overlapping booked seats
                // Overlap occurs if: existing_src < my_dest AND existing_dest > my_src
                const [booked] = await pool.query(`
                    SELECT IFNULL(SUM(booked_seats), 0) AS occupied
                    FROM reservations
                    WHERE schedule_id = ? AND seat_class_id = ? AND status = 'CONFIRMED'
                    AND source_order < ? AND dest_order > ?
                `, [train.schedule_id, c.class_id, train.dest_order, train.source_order]);

                const availableSeats = c.total_seats - booked[0].occupied;
                
                availableClasses.push({
                    class_id: c.class_id,
                    class_name: c.class_name,
                    fare: parseFloat(c.fare).toFixed(2),
                    total_seats: c.total_seats,
                    available_seats: availableSeats
                });
            }
            train.seat_classes = availableClasses;
        }

        res.json({ success: true, count: trains.length, data: trains });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Database error while searching.' });
    }
});

/**
 * @route POST /api/tickets/reserve
 * @desc Reserve a ticket using SQL Transactions to prevent overbooking
 */
app.post('/api/tickets/reserve', async (req, res) => {
    const { schedule_id, source_stop_id, dest_stop_id, seat_class_id, booked_seats, passenger_name, passenger_phone } = req.body;

    // Basic Validation
    if (!schedule_id || !source_stop_id || !dest_stop_id || !seat_class_id || !booked_seats || !passenger_name) {
        return res.status(400).json({ success: false, message: 'Missing required reservation fields.' });
    }

    if (booked_seats > 4) {
        return res.status(400).json({ success: false, message: 'Cannot book more than 4 seats per reservation.' });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Get Stop Orders & Distance
        const [stops] = await connection.query(`
            SELECT id, stop_order, distance_from_start FROM train_stops WHERE id IN (?, ?)
        `, [source_stop_id, dest_stop_id]);

        const srcStop = stops.find(s => s.id === parseInt(source_stop_id));
        const destStop = stops.find(s => s.id === parseInt(dest_stop_id));

        if (!srcStop || !destStop || srcStop.stop_order >= destStop.stop_order) {
            throw new Error('Invalid route selection.');
        }

        const distance = destStop.distance_from_start - srcStop.distance_from_start;

        // 2. Get Train ID and Class Pricing
        const [schedule] = await connection.query(`SELECT train_id FROM schedules WHERE id = ?`, [schedule_id]);
        const trainId = schedule[0].train_id;

        const [seatInfo] = await connection.query(`
            SELECT ts.total_seats, sc.price_per_km 
            FROM train_seats ts JOIN seat_classes sc ON ts.seat_class_id = sc.id
            WHERE ts.train_id = ? AND ts.seat_class_id = ? FOR UPDATE
        `, [trainId, seat_class_id]);

        if (seatInfo.length === 0) throw new Error('Invalid seat class for this train.');

        const totalFare = distance * seatInfo[0].price_per_km * booked_seats;

        // 3. Check Overlapping Availability
        const [booked] = await connection.query(`
            SELECT IFNULL(SUM(booked_seats), 0) AS occupied
            FROM reservations
            WHERE schedule_id = ? AND seat_class_id = ? AND status = 'CONFIRMED'
            AND source_order < ? AND dest_order > ?
        `, [schedule_id, seat_class_id, destStop.stop_order, srcStop.stop_order]);

        const availableSeats = seatInfo[0].total_seats - booked[0].occupied;

        if (availableSeats < booked_seats) {
            throw new Error(`Overbooking! Only ${availableSeats} seats available.`);
        }

        // 4. Create Reservation
        const pnr = generatePNR();
        await connection.query(`
            INSERT INTO reservations (pnr, schedule_id, passenger_name, passenger_phone, source_stop_id, dest_stop_id, source_order, dest_order, seat_class_id, booked_seats, total_fare)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [pnr, schedule_id, passenger_name, passenger_phone, source_stop_id, dest_stop_id, srcStop.stop_order, destStop.stop_order, seat_class_id, booked_seats, totalFare]);

        await connection.commit();

        res.json({
            success: true,
            message: 'Ticket reserved successfully.',
            ticket: {
                pnr,
                passenger_name,
                booked_seats,
                total_fare: totalFare,
                status: 'CONFIRMED'
            }
        });

    } catch (err) {
        await connection.rollback();
        res.status(400).json({ success: false, message: err.message });
    } finally {
        connection.release();
    }
});

/**
 * @route GET /api/tickets/pnr/:pnr
 * @desc Generate exact ticket details using PNR
 */
app.get('/api/tickets/pnr/:pnr', async (req, res) => {
    try {
        const [ticket] = await pool.query(`
            SELECT r.pnr, r.passenger_name, r.passenger_phone, r.booked_seats, r.total_fare, r.status, r.booking_time,
                   t.name as train_name, t.train_number,
                   sch.journey_date,
                   src.name as source_station, src_stop.departure_time,
                   dest.name as destination_station, dest_stop.arrival_time,
                   sc.name as coach_type
            FROM reservations r
            JOIN schedules sch ON r.schedule_id = sch.id
            JOIN trains t ON sch.train_id = t.id
            JOIN train_stops src_stop ON r.source_stop_id = src_stop.id
            JOIN stations src ON src_stop.station_id = src.id
            JOIN train_stops dest_stop ON r.dest_stop_id = dest_stop.id
            JOIN stations dest ON dest_stop.station_id = dest.id
            JOIN seat_classes sc ON r.seat_class_id = sc.id
            WHERE r.pnr = ?
        `, [req.params.pnr]);

        if (ticket.length === 0) return res.status(404).json({ success: false, message: 'PNR not found.' });
        res.json({ success: true, data: ticket[0] });

    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @route POST /api/tickets/cancel/:pnr
 * @desc Cancel a ticket to free up seats
 */
app.post('/api/tickets/cancel/:pnr', async (req, res) => {
    try {
        const [result] = await pool.query(`UPDATE reservations SET status = 'CANCELLED' WHERE pnr = ?`, [req.params.pnr]);
        if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'PNR not found.' });
        res.json({ success: true, message: 'Ticket cancelled successfully. Seats have been freed.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 4. SERVER INITIALIZATION
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Backend Server running efficiently on port ${PORT}`);
});