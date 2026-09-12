FROM php:8.3-fpm-alpine

RUN apk add --no-cache curl-dev \
    && docker-php-ext-install pdo pdo_mysql curl opcache

RUN { \
        echo 'upload_max_filesize=50G'; \
        echo 'post_max_size=50G'; \
        echo 'max_execution_time=0'; \
        echo 'max_input_time=0'; \
        echo 'memory_limit=512M'; \
    } > /usr/local/etc/php/conf.d/uploads.ini

# Compiled scripts stay cached between requests; timestamps are still checked so the
# bind-mounted source can be updated without a container restart.
RUN { \
        echo 'opcache.enable=1'; \
        echo 'opcache.memory_consumption=64'; \
        echo 'opcache.validate_timestamps=1'; \
        echo 'opcache.revalidate_freq=2'; \
    } > /usr/local/etc/php/conf.d/opcache.ini

# Game panel traffic is proxied through nginx auth subrequests handled here, so keep enough
# workers for a page load plus bot polls on several servers at once.
RUN { \
        echo '[www]'; \
        echo 'pm = dynamic'; \
        echo 'pm.max_children = 24'; \
        echo 'pm.start_servers = 4'; \
        echo 'pm.min_spare_servers = 2'; \
        echo 'pm.max_spare_servers = 8'; \
        echo 'pm.max_requests = 1000'; \
    } > /usr/local/etc/php-fpm.d/zz-farmservers.conf

WORKDIR /var/www/html
