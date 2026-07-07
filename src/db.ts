import sqlite3 from 'sqlite3';
import type { WorkflowDefinition } from './types.js';

const dbPath = process.env.DB_PATH ?? 'workflows.db';
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        body TEXT NOT NULL
    )`);
});

export function saveDefinition(def: WorkflowDefinition): Promise<void> {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT OR REPLACE INTO definitions (id, name, body) VALUES (?, ?, ?)',
            [def.id, def.name, JSON.stringify(def)],
            (err) => err ? reject(err) : resolve()
        );
    });
}

export function getDefinition(id: string): Promise<WorkflowDefinition | null> {
    return new Promise((resolve, reject) => {
        db.get('SELECT body FROM definitions WHERE id = ?', [id], (err, row: { body: string } | undefined) => {
            if (err) return reject(err);
            resolve(row ? JSON.parse(row.body) as WorkflowDefinition : null);
        });
    });
}

export function listDefinitions(): Promise<{ id: string; name: string }[]> {
    return new Promise((resolve, reject) => {
        db.all('SELECT id, name FROM definitions', (err, rows) => {
            if (err) return reject(err);
            resolve(rows as { id: string; name: string }[]);
        });
    });
}