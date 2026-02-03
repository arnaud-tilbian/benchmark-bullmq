import {Agenda } from 'agenda';
import { MongoBackend } from '@agendajs/mongo-backend';
import { RedisBackend } from '@agendajs/redis-backend';	

const agenda = new Agenda({
	backend: new RedisBackend({
		connectionString: 'redis://localhost:6379',
	}),
    defaultLockLimit:20,
	processEvery: 50,
});

agenda.define(
	'benchmark-job',
	async job => {
        console.log("titi")
	},
);

await agenda.start();
