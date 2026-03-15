#!/bin/bash

WEB_PORT_VALUE="${WEB_PORT:-${SERVER_PORT:-7999}}"

exec firefox "http://127.0.0.1:${WEB_PORT_VALUE}/index.html?lang=en&username=${WEB_USERNAME}&password=${WEB_PASSWORD}&login=Login"
