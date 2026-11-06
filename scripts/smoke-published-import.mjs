import { readFileSync } from 'fs';
import { createRequire } from 'module';

// Use compiled-free path via dynamic import of ts through vitest isn't needed —
// duplicate minimal check with papaparse by calling the built logic via fetch sync.

const sample = `Call Id,Caller Name,Name,Phone,Call Start Date,Duration (in Sec),Call Type,Call Tag,Status,Caller Id,Customer Id,Process Name
6a1,Shubham,Spam,+916746646510,"01/06/2026, 16:44:24",7,incoming,answered,SPAM,b811,6a1d69b26ed28fc4d25e3aa8,Dwarika dham
6a2,Vishal,Nilesh,+917020575644,"01/06/2026, 17:52:49",,outgoing,unanswered,,ff45,699c56a55877cf2e0f1a6a04,Dwarika dham
`;

const { parse } = await import('papaparse');
const parsed = parse(sample, { header: true, skipEmptyLines: true });
console.log('rows', parsed.data.length);
console.log('headers', parsed.meta.fields);
console.log('first', parsed.data[0]);

// Date normalize check
const raw = '01/06/2026, 14:37:46'.replace(/,\s+/g, ' ');
console.log('normalized date', raw);
