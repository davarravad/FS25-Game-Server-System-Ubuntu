FROM php:8.3-fpm-alpine

RUN apk add --no-cache curl-dev \
    && docker-php-ext-install pdo pdo_mysql curl

WORKDIR /var/www/html
