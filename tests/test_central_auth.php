<?php
declare(strict_types=1);
require __DIR__ . '/../app/web/src/bootstrap.php';
function check(bool $condition): void { if (!$condition) { throw new RuntimeException('Gateway authorization regression'); } }
putenv('CENTRAL_GATEWAY_TOKEN=');
check(central_gateway_user() === null);
putenv('CENTRAL_GATEWAY_TOKEN=' . str_repeat('a', 64));
$_SERVER['HTTP_X_CENTRAL_USER'] = '513527870258151439';
$_SERVER['HTTP_X_CENTRAL_ROLE'] = 'admin';
$_SERVER['HTTP_X_CENTRAL_TOKEN'] = str_repeat('b', 64);
check(central_gateway_user() === null);
$_SERVER['HTTP_X_CENTRAL_TOKEN'] = str_repeat('a', 64);
check(central_gateway_user()['discord_id'] === '513527870258151439');
check(!isset($_SESSION['user']));
$_SERVER['HTTP_X_CENTRAL_ROLE'] = 'viewer';
check(central_gateway_user() === null);
$_SERVER['HTTP_X_CENTRAL_ROLE'] = 'operator';
$_SERVER['HTTP_X_CENTRAL_USER'] = "513527870258151439\n";
check(central_gateway_user() === null);
echo "Gateway authorization checks passed\n";
