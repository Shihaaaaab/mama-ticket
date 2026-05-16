const express = require('express');
const router = express.Router();

const bookingController = require('../controllers/bookingController');

router.post('/book-ticket', bookingController.bookTicket);

module.exports = router;