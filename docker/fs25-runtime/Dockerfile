FROM binhex/arch-int-gui:latest
LABEL org.opencontainers.image.authors="Toetje585"
LABEL org.opencontainers.image.source="https://github.com/winegameservers/arch-fs25server"

# release tag name from buildx arg
ARG RELEASETAG=local

# arch from buildx --platform, e.g. amd64
ARG TARGETARCH=amd64

# add install bash script
COPY build/root/ /root/

# add bash script to run app
COPY run/nobody/ /usr/local/bin/

# add pre-configured config files for nobody
COPY config/nobody/ /home/nobody/.build/

# add rootfs files

COPY build/rootfs /

# install app
#############

# make executable and run bash scripts to install app
RUN chmod +x /root/*.sh && \
	/bin/bash /root/install.sh "${RELEASETAG}" "${TARGETARCH}"

# docker settings
#################

# env
#####

# set environment variables for user nobody
ENV HOME=/home/nobody

# set environment variable for terminal
ENV TERM=xterm

# set environment variables for language
ENV LANG=en_GB.UTF-8

# set permissions
#################

# run script to set uid, gid and permissions
CMD ["/bin/bash", "/usr/bin/init.sh"]
