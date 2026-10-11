-- Runs once, when the Postgres volume is first initialised.
-- Integration tests use their own database so they never touch development data.
CREATE DATABASE leadpilot_test;
