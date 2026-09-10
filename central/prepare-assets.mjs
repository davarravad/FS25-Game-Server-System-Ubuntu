import {copyFile} from 'node:fs/promises';
await copyFile('../scripts/node-manager.py', 'public/install.py');
await copyFile('../docs/NODE-DISTRIBUTION.md', 'public/node-distribution.txt');
await copyFile('../docs/CENTRAL-SETUP.md', 'public/central-setup.txt');
