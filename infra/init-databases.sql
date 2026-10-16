-- ========================================================
-- UrbanFleet Least-Privilege Database Initialization Script
-- Run once by postgres superuser during container initialization
-- ========================================================

-- 1. Create independent service roles
CREATE USER auth_user WITH ENCRYPTED PASSWORD 'auth_pass_local';
CREATE USER driver_user WITH ENCRYPTED PASSWORD 'driver_pass_local';
CREATE USER ride_user WITH ENCRYPTED PASSWORD 'ride_pass_local';
CREATE USER payment_user WITH ENCRYPTED PASSWORD 'payment_pass_local';
CREATE USER notification_user WITH ENCRYPTED PASSWORD 'notif_pass_local';

-- 2. Create independent databases owned by respective roles
CREATE DATABASE urbanfleet_auth OWNER auth_user;
CREATE DATABASE urbanfleet_driver OWNER driver_user;
CREATE DATABASE urbanfleet_ride OWNER ride_user;
CREATE DATABASE urbanfleet_payment OWNER payment_user;
CREATE DATABASE urbanfleet_notification OWNER notification_user;

-- 3. Revoke public connect privileges & enforce least privilege
REVOKE ALL ON DATABASE urbanfleet_auth FROM PUBLIC;
REVOKE ALL ON DATABASE urbanfleet_driver FROM PUBLIC;
REVOKE ALL ON DATABASE urbanfleet_ride FROM PUBLIC;
REVOKE ALL ON DATABASE urbanfleet_payment FROM PUBLIC;
REVOKE ALL ON DATABASE urbanfleet_notification FROM PUBLIC;

-- 4. Grant access strictly to designated owners
GRANT CONNECT, TEMPORARY ON DATABASE urbanfleet_auth TO auth_user;
GRANT CONNECT, TEMPORARY ON DATABASE urbanfleet_driver TO driver_user;
GRANT CONNECT, TEMPORARY ON DATABASE urbanfleet_ride TO ride_user;
GRANT CONNECT, TEMPORARY ON DATABASE urbanfleet_payment TO payment_user;
GRANT CONNECT, TEMPORARY ON DATABASE urbanfleet_notification TO notification_user;
