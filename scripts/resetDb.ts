import { resetDb, closeDb } from '../src/db/client';

resetDb();
closeDb();
console.log('Database reset.');
