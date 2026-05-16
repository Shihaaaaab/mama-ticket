DROP DATABASE IF EXISTS mama_ticket;
CREATE DATABASE mama_ticket;
USE mama_ticket;

-- 1. STATIONS TABLE
CREATE TABLE stations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    city VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. TRAINS TABLE
CREATE TABLE trains (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    train_number VARCHAR(20) NOT NULL UNIQUE,
    status ENUM('ACTIVE', 'INACTIVE') DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. TRAIN STOPS (The core of dynamic routing)
-- This maps out the exact route and order of stations for every train
CREATE TABLE train_stops (
    id INT AUTO_INCREMENT PRIMARY KEY,
    train_id INT NOT NULL,
    station_id INT NOT NULL,
    stop_order INT NOT NULL, -- 1 = Source, 2 = 1st Stop, etc.
    arrival_time TIME NOT NULL,
    departure_time TIME NOT NULL,
    distance_from_start INT NOT NULL, -- In KM, used to calculate fare
    FOREIGN KEY (train_id) REFERENCES trains(id) ON DELETE CASCADE,
    FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE,
    UNIQUE(train_id, station_id),
    UNIQUE(train_id, stop_order)
);

-- 4. SEAT CLASSES
CREATE TABLE seat_classes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    price_per_km DECIMAL(5,2) NOT NULL
);

-- 5. TRAIN SEAT INVENTORY
CREATE TABLE train_seats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    train_id INT NOT NULL,
    seat_class_id INT NOT NULL,
    total_seats INT NOT NULL,
    FOREIGN KEY (train_id) REFERENCES trains(id) ON DELETE CASCADE,
    FOREIGN KEY (seat_class_id) REFERENCES seat_classes(id) ON DELETE CASCADE,
    UNIQUE(train_id, seat_class_id)
);

-- 6. SCHEDULES (Specific journey dates)
CREATE TABLE schedules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    train_id INT NOT NULL,
    journey_date DATE NOT NULL,
    status ENUM('ON_TIME', 'DELAYED', 'CANCELLED') DEFAULT 'ON_TIME',
    FOREIGN KEY (train_id) REFERENCES trains(id) ON DELETE CASCADE,
    UNIQUE(train_id, journey_date)
);

-- 7. RESERVATIONS (Tickets)
CREATE TABLE reservations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pnr VARCHAR(20) NOT NULL UNIQUE,
    schedule_id INT NOT NULL,
    passenger_name VARCHAR(100) NOT NULL,
    passenger_phone VARCHAR(20) NOT NULL,
    source_stop_id INT NOT NULL, -- References train_stops.id
    dest_stop_id INT NOT NULL,   -- References train_stops.id
    source_order INT NOT NULL,   -- Copied for fast overlap checking
    dest_order INT NOT NULL,     -- Copied for fast overlap checking
    seat_class_id INT NOT NULL,
    booked_seats INT NOT NULL,
    total_fare DECIMAL(10,2) NOT NULL,
    status ENUM('CONFIRMED', 'CANCELLED') DEFAULT 'CONFIRMED',
    booking_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (source_stop_id) REFERENCES train_stops(id),
    FOREIGN KEY (dest_stop_id) REFERENCES train_stops(id),
    FOREIGN KEY (seat_class_id) REFERENCES seat_classes(id)
);

-- INDEXES FOR FAST SEARCHING
CREATE INDEX idx_train_stops ON train_stops(station_id, train_id);
CREATE INDEX idx_schedules ON schedules(journey_date, train_id);
CREATE INDEX idx_reservations_pnr ON reservations(pnr);

-- ==========================================
-- SEED DATA
-- ==========================================

-- Insert Stations
INSERT INTO stations (name, city) VALUES 
('Dhaka (Kamalapur)', 'Dhaka'), ('Biman Bandar', 'Dhaka'), ('Tongi', 'Gazipur'), 
('Bhairab Bazar', 'Kishoreganj'), ('Akhaura', 'Brahmanbaria'), ('Chittagong', 'Chittagong'),
('Srimangal', 'Moulvibazar'), ('Sylhet', 'Sylhet'), ('Joydebpur', 'Gazipur'),
('Tangail', 'Tangail'), ('Sirajganj', 'Sirajganj'), ('Rajshahi', 'Rajshahi'),
('Ishwardi', 'Pabna'), ('Jessore', 'Jessore'), ('Khulna', 'Khulna');

-- Insert Seat Classes (Base fare multipliers)
INSERT INTO seat_classes (name, price_per_km) VALUES 
('Shovan', 1.50), ('Shovan Chair', 2.00), ('Snigdha (AC)', 3.50), ('AC Berth', 5.00);

-- Insert Trains
INSERT INTO trains (name, train_number) VALUES 
('Subarna Express', '701'), ('Parabat Express', '709'), 
('Silk City Express', '715'), ('Chitra Express', '761');

-- SEED ROUTE 1: Subarna Express (Dhaka -> Chittagong)
INSERT INTO train_stops (train_id, station_id, stop_order, arrival_time, departure_time, distance_from_start) VALUES
(1, 1, 1, '07:00:00', '07:00:00', 0),    -- Dhaka
(1, 2, 2, '07:25:00', '07:30:00', 15),   -- Airport
(1, 6, 3, '12:20:00', '12:20:00', 320);  -- Chittagong (Non-stop after airport)

-- SEED ROUTE 2: Parabat Express (Dhaka -> Sylhet)
INSERT INTO train_stops (train_id, station_id, stop_order, arrival_time, departure_time, distance_from_start) VALUES
(2, 1, 1, '06:20:00', '06:20:00', 0),    -- Dhaka
(2, 2, 2, '06:45:00', '06:50:00', 15),   -- Airport
(2, 4, 3, '08:10:00', '08:15:00', 80),   -- Bhairab
(2, 5, 4, '09:00:00', '09:05:00', 115),  -- Akhaura
(2, 7, 5, '11:30:00', '11:35:00', 250),  -- Srimangal
(2, 8, 6, '13:00:00', '13:00:00', 319);  -- Sylhet

-- SEED ROUTE 3: Silk City (Dhaka -> Rajshahi)
INSERT INTO train_stops (train_id, station_id, stop_order, arrival_time, departure_time, distance_from_start) VALUES
(3, 1, 1, '14:45:00', '14:45:00', 0),    -- Dhaka
(3, 2, 2, '15:15:00', '15:20:00', 15),   -- Airport
(3, 9, 3, '15:50:00', '15:55:00', 35),   -- Joydebpur
(3, 10, 4, '16:45:00', '16:50:00', 95),  -- Tangail
(3, 11, 5, '18:10:00', '18:15:00', 135), -- Sirajganj
(3, 12, 6, '20:30:00', '20:30:00', 260); -- Rajshahi

-- SEED ROUTE 4: Chitra Express (Dhaka -> Khulna)
INSERT INTO train_stops (train_id, station_id, stop_order, arrival_time, departure_time, distance_from_start) VALUES
(4, 1, 1, '19:00:00', '19:00:00', 0),    -- Dhaka
(4, 13, 2, '23:30:00', '23:45:00', 210), -- Ishwardi
(4, 14, 3, '02:10:00', '02:15:00', 325), -- Jessore
(4, 15, 4, '03:40:00', '03:40:00', 390); -- Khulna

-- Insert Train Seats Configuration
INSERT INTO train_seats (train_id, seat_class_id, total_seats) VALUES
(1, 2, 400), (1, 3, 150), -- Subarna: Shovan Chair, Snigdha
(2, 1, 200), (2, 2, 300), (2, 3, 100), -- Parabat
(3, 2, 350), (3, 3, 100), -- Silk City
(4, 2, 400), (4, 3, 120), (4, 4, 50); -- Chitra

-- Insert Schedules (Generating schedules for the next few days)
-- Note: In a real app, a cron job generates these automatically.
INSERT INTO schedules (train_id, journey_date) VALUES
(1, CURDATE()), (1, DATE_ADD(CURDATE(), INTERVAL 1 DAY)), (1, DATE_ADD(CURDATE(), INTERVAL 2 DAY)),
(2, CURDATE()), (2, DATE_ADD(CURDATE(), INTERVAL 1 DAY)), (2, DATE_ADD(CURDATE(), INTERVAL 2 DAY)),
(3, CURDATE()), (3, DATE_ADD(CURDATE(), INTERVAL 1 DAY)), (3, DATE_ADD(CURDATE(), INTERVAL 2 DAY)),
(4, CURDATE()), (4, DATE_ADD(CURDATE(), INTERVAL 1 DAY)), (4, DATE_ADD(CURDATE(), INTERVAL 2 DAY));