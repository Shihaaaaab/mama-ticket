const db = require('../config/database');

exports.bookTicket = async (req, res) => {
    const { userId, scheduleId, totalFare, passengers } = req.body;
    
    // Convert passengers array to JSON string for MySQL Stored Procedure
    const passengersJson = JSON.stringify(passengers);

    try {
        // Execute the stored procedure transaction
        const [result] = await db.query(
            'CALL book_ticket(?, ?, ?, ?, @pnr, @status);',
            [userId, scheduleId, totalFare, passengersJson]
        );

        // Fetch the OUT parameters from the procedure
        const [outParams] = await db.query('SELECT @pnr AS pnr, @status AS status;');
        const { pnr, status } = outParams[0];

        if (status === 'FAILED_ROLLBACK') {
            return res.status(500).json({ message: 'Transaction failed, rolled back.' });
        }

        res.status(200).json({ 
            message: 'Booking Processed', 
            pnr: pnr, 
            status: status 
        });

    } catch (error) {
        res.status(500).json({ message: 'Database Error', error: error.message });
    }
};
