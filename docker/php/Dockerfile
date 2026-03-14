FROM php:8.3-fpm-alpine

RUN apk add --no-cache curl-dev \
    && docker-php-ext-install pdo pdo_mysql curl

RUN { \
        echo 'upload_max_filesize=50G'; \
        echo 'post_max_size=50G'; \
        echo 'max_execution_time=0'; \
        echo 'max_input_time=0'; \
        echo 'memory_limit=512M'; \
    } > /usr/local/etc/php/conf.d/uploads.ini

WORKDIR /var/www/html
