import {Agenda } from 'agenda';
import { RedisBackend } from '@agendajs/redis-backend';

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const agenda = new Agenda({
	backend: new RedisBackend({
		connectionString: 'redis://localhost:6379',
	}),
});

while(true) {	
    await agenda.now('benchmark-job', { to: 'admin@example.com' });
    await sleep(50);
}
