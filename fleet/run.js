const path = require('path');
const express = require('express');
const { buildApp, basicAuth } = require('./server');
const { createWorker } = require('./worker');

const PORT = process.env.FLEET_PORT || 3100;
const app = buildApp(process.env.FLEET_DB || '/app/data/fleet.json');
const worker = createWorker(app.locals.store);
app.locals.worker = worker;
app.use(basicAuth);
app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, '0.0.0.0', () => console.log(`Fleet panel on http://0.0.0.0:${PORT}`));
