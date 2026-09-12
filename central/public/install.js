'use strict';
// Step-by-step guide for bringing a brand-new Ubuntu host into the fleet.
// Every command is copy-paste ready. The only per-node values are entered
// interactively by the installer (node ID and token) or are the node's own
// SSH address, which is marked NODE-IP.
function installGuide(){
  const para=(parent,text,className)=>parent.append(element('p',text,className));
  const code=(parent,text)=>parent.append(element('pre',text));
  const list=(parent,items,ordered=false)=>{const box=element(ordered?'ol':'ul',undefined,'guide-list');for(const item of items){const li=element('li');if(Array.isArray(item)){li.append(element('strong',item[0]),document.createTextNode(' '+item[1]));}else li.textContent=item;box.append(li);}parent.append(box);return box;};
  const links=(parent,...pairs)=>{const box=element('div',undefined,'actions');for(const [text,href] of pairs)box.append(link(text,href));parent.append(box);};
  const table=(parent,headers,rows)=>{const t=element('table',undefined,'guide-paths'),head=element('tr');for(const h of headers)head.append(element('th',h));t.append(head);for(const row of rows){const tr=element('tr');for(const cell of row){const td=element('td');if(cell.startsWith('`'))td.append(element('code',cell.slice(1,-1)));else td.textContent=cell;tr.append(td);}t.append(tr);}const wrap=element('div',undefined,'update-table-wrap');wrap.append(t);parent.append(wrap);};

  const overview=section('How a new node comes together');
  para(overview,'A node is one Ubuntu machine that hosts your game servers. Follow the steps in order: prepare Ubuntu, create the node here, run the installer, let Cloudflare connect it, load the game files, then create and start the first game server. Allow about an hour, most of it waiting for downloads. Every command below can be pasted as-is; the installer asks for the node ID and token itself.');
  list(overview,[['1.','Prepare Ubuntu 24.04'],['2.','Create the node on this site and copy its token'],['3.','Run the installer on the host'],['4.','Confirm the node reports in'],['5.','Connect it through Cloudflare'],['6.','Check host settings and storage'],['7.','Load the game files'],['8.','Create and start the first game server'],['9.','Verify security and recovery']]);

  const paths=section('Paths on every node');
  para(paths,'New nodes use the same data and shared paths as the existing nodes, so backups, SFTP layouts and instructions apply to all of them. The application directory is the one difference: site-installed nodes keep the application under /opt/farmservers/node, while nodes adopted from the original Git checkout keep their existing directory.');
  table(paths,['What','Where','Notes'],[
    ['Application and .env','`/opt/farmservers/node`','Root-only. Docker Compose project name farmservers.'],
    ['Game server instances','`/opt/fsg-panel/instances/INSTANCE-ID/`','compose.yml, .env and data/{config,mods,logs,saves} per server.'],
    ['Local update backups','`/opt/fsg-panel/backups`','Used by the node; site updates also back up to /var/backups/farmservers.'],
    ['Shared game installation','`/opt/fs25/game`','One Farming Simulator 25 install shared by every server on the node.'],
    ['Shared DLC installers','`/opt/fs25/dlc`','FarmingSimulator25_PACKAGE_VERSION.exe files.'],
    ['Shared installer','`/opt/fs25/installer`','FarmingSimulator2025.exe from the GIANTS download.'],
    ['Updater configuration','`/etc/farmservers/updater.json`','Root-only; holds this node’s ID, token and pinned signing key.'],
    ['Tunnel connector','`/etc/farmservers/tunnel-compose.json`','cloudflared runs in the farmservers-connection Compose project.'],
    ['Telemetry history','`/opt/fsg-panel/instances/.telemetry.sqlite3`','30 days of local samples.'],
    ['Panel port','`127.0.0.1:8080`','Loopback only; reached through the tunnel or an SSH port forward.'],
    ['Admin SFTP','`127.0.0.1:22220`','Loopback only; user paneladmin, password in .env.']
  ]);

  const before=section('Before you begin');
  para(before,'You need all of the following. Missing any one of them is the most common reason a new node stalls.');
  list(before,[
    ['Hardware:','x86_64 (Intel Haswell / AMD Zen or newer). 2 to 4 players without DLC: 3 cores at 2.4 GHz and 4 GB RAM per game server. Up to 16 players with all DLC: 4 cores at 3.2 GHz and 12 GB RAM per game server. ARM and Apple hardware are not supported.'],
    ['Disk:','At least 65 GB free for the shared game files and DLC, plus room for each server’s saves, mods and logs, plus 10 GB for Docker images. Use an SSD.'],
    ['Network:','A fixed public IPv4 address, or a router that can port-forward to this host. One TCP and UDP game port per game server (10823 by default). Outbound HTTPS to this site and to Cloudflare must be open.'],
    ['Ubuntu:','A fresh Ubuntu Server 24.04 LTS install with a user that can run sudo and SSH key access. Do not reuse a host that already runs Docker workloads you do not control.'],
    ['Game licence:','A separate, non-Steam Farming Simulator 25 licence for every game server you will run on this node, plus keys for any DLC you want on those servers. The Steam edition cannot run as a dedicated server. GIANTS requires a second purchase for hosting; the Year 1 Bundle covers all content.'],
    ['Site access:','An Administrator account here. Staff and viewers cannot create nodes or open consoles.']
  ]);

  const ubuntu=section('Step 1: Prepare Ubuntu');
  para(ubuntu,'Sign in over SSH and bring the host up to date. The timezone matches the existing nodes and is used for save timestamps and logs.');
  code(ubuntu,"sudo apt-get update && sudo apt-get -y full-upgrade && sudo apt-get install -y ca-certificates curl python3 openssl ufw && sudo timedatectl set-timezone America/New_York");
  para(ubuntu,'Turn on the firewall with SSH allowed. When you create a game server the node agent adds that server’s published ports to UFW itself; because VNC, noVNC and web admin ports are published on loopback only, the game port and that server’s SFTP port are the ones that become reachable.');
  code(ubuntu,"sudo ufw allow OpenSSH && sudo ufw --force enable && sudo ufw status");
  para(ubuntu,'Reboot so Docker installs against the running kernel, then sign back in.');
  code(ubuntu,"sudo reboot");
  para(ubuntu,'Do not install Docker yourself. The installer adds Docker Engine and the Compose plugin from Docker’s own repository so the versions match what the runtime expects.','muted');

  const create=section('Step 2: Create the node on this site');
  list(create,[
    'Open Server Nodes and use Create a node.',
    'Choose a node ID: lowercase letters, digits and dashes, starting with a letter or digit, up to 63 characters, for example home-node02. The ID is permanent and appears in every URL and audit entry, so pick it carefully.',
    'Give it a display name (this can be changed later), then create it.',
    'On the new node’s page open the Connection & access tab. Under Publishing token choose View token, then Copy token. Keep it in your clipboard or password manager; you paste it into the installer in the next step. Never put it in chat, a ticket or a shell command.'
  ],true);
  links(create,['Server Nodes','/nodes']);

  const install=section('Step 3: Run the installer on the host');
  para(install,'Back on the Ubuntu host, download the installer from this site and run it as root.');
  code(install,"curl --fail --show-error --silent --proto '=https' --tlsv1.2 https://farmservers.sargentweb.com/install.py -o /tmp/farmservers-install.py && sudo python3 /tmp/farmservers-install.py --install");
  para(install,'The installer asks four things:');
  list(install,[
    ['Node ID from Server Nodes:','the ID you chose in step 2.'],
    ['Node token (hidden):','paste the token. Nothing is echoed to the terminal.'],
    ['Type TRUST to pin this signing key:','the installer prints the SHA256 fingerprint of the release signing key. Compare it with the fingerprint your release maintainer gave you. Only type TRUST if they match; this key is what the node checks every future update against.'],
    ['Release to install:','type one of the listed versions, normally the newest.']
  ],true);
  para(install,'It then works unattended for several minutes. What it does, so you can recognise a healthy run:');
  list(install,[
    'Downloads and verifies the signed release, then unpacks it to /opt/farmservers/node.',
    'Installs Docker Engine and the Compose plugin from Docker’s repository if they are missing.',
    'Writes /opt/farmservers/node/.env (root-only) with generated database, agent, API, SFTP and gateway secrets, CENTRAL_MODE=1 and the panel bound to 127.0.0.1:8080.',
    'Creates /opt/fsg-panel/instances, /opt/fsg-panel/backups, /opt/fs25/game, /opt/fs25/dlc and /opt/fs25/installer, owned by UID and GID 1000 as the game containers expect.',
    'Builds and starts the control containers: web, nginx, db, agent, publisher and admin-sftp, under the Compose project name farmservers.',
    'Waits until the panel answers and all four control services are running.',
    'Saves /etc/farmservers/updater.json and enables two root systemd timers: farmservers-update.timer (site-requested updates and connection setup, every 30 seconds) and farmservers-game-sync.timer (game library detection and transfers, every minute).'
  ]);
  para(install,'The last line should read “Remote updates enabled. Enable Cloudflare automation on the site to connect this node.” Confirm the services yourself:');
  code(install,"systemctl status farmservers-update.timer farmservers-game-sync.timer --no-pager && cd /opt/farmservers/node && sudo docker compose --profile central ps");
  para(install,'If the installer stops partway, do not delete anything and do not run --install again. Fix the reported problem, start the stack with the command below, then adopt the directory as described at the bottom of this page.','notice');
  code(install,"cd /opt/farmservers/node && sudo docker compose --profile central up -d --build");

  const report=section('Step 4: Confirm the node reports in');
  para(report,'The publisher container sends a heartbeat every 30 seconds. Within two minutes the node shows Online on Overview and on its own page, with a host CPU and memory reading.');
  list(report,[
    'If it stays Offline, read the publisher log. Heartbeat accepted means credentials and connectivity are fine; 401 means the token or node ID is wrong; a timeout means outbound HTTPS is blocked.',
    'Check the clock. Heartbeats with timestamps more than an hour off are rejected; timedatectl should show System clock synchronized: yes.'
  ]);
  code(report,"cd /opt/farmservers/node && sudo docker compose --profile central logs --tail=40 publisher && timedatectl");
  links(report,['Overview','/']);

  const connect=section('Step 5: Connect it through Cloudflare');
  para(connect,'Management, game admin and VNC reach the node through a Cloudflare Tunnel, not through open ports. The site creates everything once automation is enabled.');
  list(connect,[
    'Open the Cloudflare page. If it shows Connected and Automatic node connections: Enabled, nothing to do here. Otherwise connect with Cloudflare (or save an API token) and set Automatic node connections to Enabled.',
    'Watch the node’s Connection & access tab. The Node connection progress card walks through Creating tunnel, Creating Access credentials, Protecting the hostname, Configuring tunnel route, Publishing DNS, Preparing connector, Installing the node connector and Checking the protected connection. Each stage advances on the node’s next 30-second poll, so allow five to ten minutes.',
    'Ready means the site verified the protected health endpoint and saved the gateway. The node now runs a cloudflared container in the farmservers-connection Compose project with a tunnel hostname of the form origin-NODE-ID.sargentweb.com. That hostname only accepts requests carrying the site’s Access credentials.',
    'If a stage reports an error, read it, fix the cause in Cloudflare or on the host, then use Retry setup on the card. Existing DNS records or Access applications with the same name are never overwritten; remove the conflict first.'
  ],true);
  para(connect,'Useful checks on the host while waiting:');
  code(connect,"sudo journalctl -u farmservers-update.service -n 50 --no-pager && sudo docker compose -p farmservers-connection -f /etc/farmservers/tunnel-compose.json logs --tail 50");
  links(connect,['Cloudflare','/cloudflare']);

  const host=section('Step 6: Check host settings and storage');
  para(host,'Once connected, open the node’s Host settings tab.');
  list(host,[
    'Game access hostname / IP must be the public address players connect to. The installer fills in the host’s first local IP, which is wrong behind NAT. Set it to the public IP or DNS name and save.',
    'Leave Agent API URL as http://agent:8081 and the agent token blank; both were generated by the installer.',
    'Shared game, DLC and installer paths are /opt/fs25/game, /opt/fs25/dlc and /opt/fs25/installer, the same as the existing nodes. Change them only if you mounted a larger disk elsewhere, then save.',
    'Choose Prepare shared storage. This creates the folders with the ownership the game containers need.',
    'Agent health should read Healthy. Needs attention means the web service cannot reach the agent; check docker compose ps on the host.'
  ],true);

  const game=section('Step 7: Load the game files');
  para(game,'Every game server on the node shares one installation of Farming Simulator 25 under /opt/fs25/game. There are two ways to get it onto a new node. The first is much faster.');
  para(game,'Option A: copy from your game library (recommended when another node already runs the game).');
  list(game,[
    'Open Game status. If a version shows Approved and “Automatically prepare empty new nodes” is ticked, the new node requests it on its first game scan without any action from you.',
    'Otherwise find the node’s card and choose Sync approved version. Progress and byte counts refresh every five seconds; the transfer resumes on its own after interruptions and a reboot.',
    'The node card reads Game files ready when the copy is verified. DLC installers are copied only for packages you select per server later, so a brand-new node receives the base game first.'
  ],true);
  para(game,'Option B: install from the GIANTS installer (first node, or a newer game version).');
  list(game,[
    'Download the Farming Simulator 25 installer zip from your GIANTS account on another computer.',
    'Upload it to the node under Shared files, location installer. Browser uploads go in 2 MiB chunks and are fine for a few gigabytes over a good connection.',
    'For a faster transfer of a large file use the node’s admin SFTP instead. Export & access shows the password. The SFTP port is bound to loopback, so open the SSH port forward below from your workstation, then connect your SFTP client to localhost port 22220 as paneladmin and put the file in panel/shared/installer.',
    'Back in Shared files, use Extract installer next to the zip. The extracted FarmingSimulator2025.exe must end up directly in the installer folder.',
    'Put any DLC installers (FarmingSimulator25_PACKAGE_VERSION.exe) in the dlc location the same way; Install Game in the next step installs the ones it finds.',
    'The actual installation into /opt/fs25/game happens from the first game server’s VNC console in step 8.'
  ],true);
  code(game,"ssh -L 22220:127.0.0.1:22220 NODE-IP");
  links(game,['Game status','/game-status']);

  const server=section('Step 8: Create and start the first game server');
  para(server,'Open the node and choose Create game server. The node suggests free ports and generates every password; review rather than retype.');
  list(server,[
    ['Server basics:','the name players see, an instance ID (letters, digits, dash, underscore; permanent), player limit up to 16 and the startup mode. Keep Start game automatically unless you are still installing.'],
    ['Game options:','map, region and crossplay. These seed the game’s first start only; afterwards change them in the game admin panel. The server’s Settings tab never touches them.'],
    ['Passwords & access:','the join password and in-game admin password; the web panel, SFTP and VNC credentials. Note the VNC and web passwords; you need them in a moment. They are also shown on the server’s Settings tab later.'],
    ['Advanced settings:','the game port must be reachable from the internet on TCP and UDP, and the SFTP port is reachable on TCP so third-party SFTP clients can connect to this server directly. If you have port forwarding, forward both suggested ports to this host now. VNC, noVNC and web admin ports are administrative and stay on loopback. Leave difficulty, pause, save interval, stats interval and the runtime image at their defaults.']
  ]);
  para(server,'Create the server. The agent renders its Compose project under /opt/fsg-panel/instances, creates its data folders and opens the game port in UFW. Then open the new server and finish the game setup through its console:');
  list(server,[
    'On the server’s Overview choose Open VNC console and enter the VNC password. You see a small desktop with four launchers.',
    'Install Game: only needed when /opt/fs25/game is still empty (option B above). It runs the GIANTS installer silently, then opens the game once to check for updates. When the game asks for a licence key, enter this server’s key. If it offers a GPU driver update, choose No. Each server activates its own licence; keys are stored in that server’s profile, not in the shared folder.',
    'Setup Server: prepares this instance’s server files for its web port and copies the default dedicated server configuration. Run it on every new server, including ones whose game files arrived through the library.',
    'Start Server: starts the dedicated server process. With Start game automatically selected this also happens on every container start.',
    'Close the console. From the server’s Overview choose Open game admin panel, sign in with the web username and password, and check the map, savegame and mods. Copy public game panel URL gives you a shareable address for that panel; it still requires the web login.'
  ],true);
  para(server,'The server card shows Running, then the game version, player count and map once the game publishes its stats feed (a minute or two). Start, stop and restart live on the server’s Overview; logs are under Logs & containers.');
  links(server,['Game Servers','/servers']);

  const verify=section('Step 9: Verify security and recovery');
  para(verify,'Before handing the node to players, confirm these on the host and from a second computer.');
  list(verify,[
    'The port listing below shows the game port on 0.0.0.0 and every other port on 127.0.0.1. Docker port publishing bypasses UFW, so a mistake here is public.',
    'From another network, the game port answers in the in-game server browser and the node’s IP refuses connections on 8080, 5900, 6080, 22220, the server SFTP port and the game web port.',
    'Reboot the host. Within three minutes the node is Online again, the tunnel is Ready and servers that were running are running again.',
    'Automatic Ubuntu security updates (unattended-upgrades) should be active; keep SSH key access and do not add password logins.',
    'Take off-host backups of /opt/fsg-panel/instances (saves, mods, configuration) and of /opt/farmservers/node/.env. Site updates back up the panel database and configuration locally under /var/backups/farmservers, which is not disaster recovery.',
    'Keep .env, /etc/farmservers and the publishing token private. If a token leaks, rotate it on Connection & access and update the node.'
  ]);
  code(verify,"for c in $(sudo docker ps --format '{{.Names}}'); do echo \"== $c\"; sudo docker port \"$c\"; done; sudo systemctl status unattended-upgrades --no-pager | head -3; sudo ufw status numbered");
  para(verify,'Local recovery, if the tunnel is ever unavailable: the node’s own web service still answers on 127.0.0.1:8080 through an SSH port forward, but it only redirects browsers here. Use it for the machine API and health checks, and use SSH plus Docker Compose for everything else.','muted');
  code(verify,"ssh -L 8080:127.0.0.1:8080 NODE-IP");

  const updates=section('Keeping the node current');
  para(updates,'Node software is updated from this site, never by editing files on the host. When a new signed release is published, the node’s Overview shows it under Node software; queue it there, or update the whole fleet from Node updates. Running game servers are not restarted by a node software update. Game version changes go through Game status.');
  links(updates,['Node updates','/setup'],['Full installation and update guide','/node-distribution.txt'],['Control plane setup guide','/central-setup.txt']);

  const migrate=section('Connect an existing installation instead');
  para(migrate,'For a node that was installed from the Git repository before site-hosted releases existed: apply the reviewed bridge update, back up its configuration and game saves, complete its central enrollment, then download the installer as in step 3 and adopt the existing checkout. Adoption keeps the directory, .env, database and running servers, and only enables the site updater and timers. Replace the path with that node’s checkout, for example the FS25-Game-Server-System-Ubuntu folder in the home directory it was cloned into.');
  code(migrate,"curl --fail --show-error --silent --proto '=https' --tlsv1.2 https://farmservers.sargentweb.com/install.py -o /tmp/farmservers-install.py && sudo python3 /tmp/farmservers-install.py --adopt \"$HOME/FS25-Game-Server-System-Ubuntu\"");
  links(migrate,['Full migration guide','/node-distribution.txt']);
}
