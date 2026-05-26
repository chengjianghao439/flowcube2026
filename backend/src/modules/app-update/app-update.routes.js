const express = require('express')
const ctrl = require('./app-update.controller')

const router = express.Router()

router.get('/latest', ctrl.getLatest)

module.exports = router
