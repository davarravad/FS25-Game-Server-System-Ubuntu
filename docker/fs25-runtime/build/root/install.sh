#!/bin/bash

# exit script if return code != 0
set -e

# release tag name from buildx arg, stripped of build ver using string manipulation
RELEASETAG="${1}"

# target arch from buildx arg
TARGETARCH="${2}"

if [[ -z "${RELEASETAG}" ]]; then
	echo "[warn] Release tag name from build arg is empty, exiting script..."
	exit 1
fi

if [[ -z "${TARGETARCH}" ]]; then
	echo "[warn] Target architecture name from build arg is empty, exiting script..."
	exit 1
fi

# write RELEASETAG to file to record the release tag used to build the image
echo "INT_RELEASE_TAG=${RELEASETAG}" >> '/etc/image-release'

# note do NOT download build scripts - inherited from int script with envvars common defined


# Add multilib repository to run 32-bit applications on 64-bit installs

echo -e " \n\
[multilib] \n\
Include = /etc/pacman.d/mirrorlist \n\
" >> /etc/pacman.conf

# pacman packages
####

pacman -Sy

# call pacman db and package updater script
source upd.sh

# define pacman packages
pacman_packages="samba exo garcon thunar xfce4-appfinder tumbler xfce4-panel xfce4-session xfce4-settings xfce4-terminal xfconf xfdesktop xfwm4 nodejs npm socat"


# install compiled packages using pacman
if [[ ! -z "${pacman_packages}" ]]; then
	pacman -S --needed $pacman_packages --noconfirm
fi


# install a downgraded version of wine due https://bugs.winehq.org/show_bug.cgi?id=56790
# wine-staging 10.1 still depends on lib32-gettext and lib32-libpcap, which Arch has since removed from multilib.
# lib32-gettext is installed from the Arch archive. lib32-libpcap only provides Wine's optional packet capture
# (wpcap), which a game server never uses, and even its newest archived build needs packages that no longer exist,
# so that one dependency is skipped.
archive_url="https://archive.archlinux.org/packages"
wine_package="${archive_url}/w/wine-staging/wine-staging-10.1-1-x86_64.pkg.tar.zst"
gettext_package="${archive_url}/l/lib32-gettext/lib32-gettext-1.0-1-x86_64.pkg.tar.zst"

if ! pacman -U "${wine_package}" "${gettext_package}" --noconfirm --assume-installed lib32-libpcap=1.10.6; then
	echo "[warn] wine-staging could not be installed with the archived lib32-gettext, retrying without it"
	pacman -U "${wine_package}" --noconfirm --assume-installed lib32-gettext=1.0 --assume-installed lib32-libpcap=1.10.6
fi

# aur packages
####

# define aur packages
#aur_packages="legendary"

## call aur install script (arch user repo)
#source aur.sh

# container perms
####

# define comma separated list of paths
install_paths="/home/nobody"

# split comma separated string into list for install paths
IFS=',' read -ra install_paths_list <<< "${install_paths}"

# process install paths in the list
for i in "${install_paths_list[@]}"; do

	# confirm path(s) exist, if not then exit, do not quote to permit wildcards
	if [ ! -d ${i} ]; then
		echo "[crit] Path '${i}' does not exist, exiting build process..." ; exit 1
	fi

done

# convert comma separated string of install paths to space separated, required for chmod/chown processing
install_paths=$(echo "${install_paths}" | tr ',' ' ')

# set permissions for container during build - Do NOT double quote variable for install_paths otherwise this will wrap space separated paths as a single string
chmod -R 775 ${install_paths}

chmod -R +x /usr/local/bin/*.sh

# create file with contents of here doc, note EOF is NOT quoted to allow us to expand current variable 'install_paths'
# we use escaping to prevent variable expansion for PUID and PGID, as we want these expanded at runtime of init.sh
cat <<EOF > /tmp/permissions_heredoc

# get previous puid/pgid (if first run then will be empty string)
previous_puid=\$(cat "/root/puid" 2>/dev/null || true)
previous_pgid=\$(cat "/root/pgid" 2>/dev/null || true)

# if first run (no puid or pgid files in /tmp) or the PUID or PGID env vars are different
# from the previous run then re-apply chown with current PUID and PGID values.
if [[ ! -f "/root/puid" || ! -f "/root/pgid" || "\${previous_puid}" != "\${PUID}" || "\${previous_pgid}" != "\${PGID}" ]]; then

	# set permissions inside container - Do NOT double quote variable for install_paths otherwise this will wrap space separated paths as a single string
	chown -R "\${PUID}":"\${PGID}" ${install_paths}

fi

# write out current PUID and PGID to files in /root (used to compare on next run)
echo "\${PUID}" > /root/puid
echo "\${PGID}" > /root/pgid

EOF

# replace permissions placeholder string with contents of file (here doc)
sed -i '/# PERMISSIONS_PLACEHOLDER/{
    s/# PERMISSIONS_PLACEHOLDER//g
    r /tmp/permissions_heredoc
}' /usr/bin/init.sh
rm /tmp/permissions_heredoc

# env vars
####

cat <<'EOF' > /tmp/envvars_heredoc

# Gameserver profile template

if [ -n "$SERVER_NAME" ]; then
    sed -i "s/<game_name><\/game_name>/<game_name>$SERVER_NAME<\/game_name>/" /home/nobody/.build/fs25/default_dedicatedServerConfig.xml
fi

if [ -n "$SERVER_ADMIN" ]; then
    sed -i "s/<admin_password><\/admin_password>/<admin_password>$SERVER_ADMIN<\/admin_password>/" /home/nobody/.build/fs25/default_dedicatedServerConfig.xml
fi

if [ -n "$SERVER_PASSWORD" ]; then
    sed -i "s/<game_password><\/game_password>/<game_password>$SERVER_PASSWORD<\/game_password>/" /home/nobody/.build/fs25/default_dedicatedServerConfig.xml
fi

if [ -n "$SERVER_PLAYERS" ]; then
    sed -i "s/<max_player>12<\/max_player>/<max_player>$SERVER_PLAYERS<\/max_player>/" /home/nobody/.build/fs25/default_dedicatedServerConfig.xml
fi

if [ -n "$SERVER_PORT" ]; then
    sed -i "s/<port>10823<\/port>/<port>$SERVER_PORT<\/port>/" /home/nobody/.build/fs25/default_dedicatedServerConfig.xml
fi

if [ -n "$SERVER_REGION" ]; then
    sed -i "s/<language>en<\/language>/<language>$SERVER_REGION<\/language>/" /home/nobody/.build/fs25/default_dedicatedServerConfig.xml
fi

if [ -n "$SERVER_MAP" ]; then
    sed -i "s/<mapID>MapUS<\/mapID>/<mapID>$SERVER_MAP<\/mapID>/" /home/nobody/.build/fs25/default_dedicatedServerConfig.xml
fi

if [ -n "$SERVER_DIFFICULTY" ]; then
    sed -i "s/<difficulty>3<\/difficulty>/<difficulty>$SERVER_DIFFICULTY<\/difficulty>/" /home/nobody/.build/fs25/default_dedicatedServerConfig.xml
fi

if [ -n "$SERVER_PAUSE" ]; then
    sed -i "s/<pause_game_if_empty>2<\/pause_game_if_empty>/<pause_game_if_empty>$SERVER_PAUSE<\/pause_game_if_empty>/" /home/nobody/.build/fs25/default_dedicatedServerConfig.xml
fi

if [ -n "$SERVER_SAVE_INTERVAL" ]; then
    sed -i "s/<auto_save_interval>180.000000<\/auto_save_interval>/<auto_save_interval>$SERVER_SAVE_INTERVAL<\/auto_save_interval>/" /home/nobody/.build/fs25/default_dedicatedServerConfig.xml
fi

if [ -n "$SERVER_STATS_INTERVAL" ]; then
    sed -i "s/<stats_interval>360.000000<\/stats_interval>/<stats_interval>$SERVER_STATS_INTERVAL<\/stats_interval>/" /home/nobody/.build/fs25/default_dedicatedServerConfig.xml
fi

if [ -n "$SERVER_CROSSPLAY" ]; then
    sed -i "s/<crossplay_allowed>true<\/crossplay_allowed>/<crossplay_allowed>$SERVER_CROSSPLAY<\/crossplay_allowed>/" /home/nobody/.build/fs25/default_dedicatedServerConfig.xml
fi

export APPLICATION="fs25server"

EOF

# replace env vars placeholder string with contents of file (here doc)
sed -i '/# ENVVARS_PLACEHOLDER/{
    s/# ENVVARS_PLACEHOLDER//g
    r /tmp/envvars_heredoc
}' /usr/bin/init.sh
rm /tmp/envvars_heredoc

# cleanup
cleanup.sh
