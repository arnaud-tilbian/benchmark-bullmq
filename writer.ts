import {Agenda } from 'agenda';
import { MongoBackend } from '@agendajs/mongo-backend';

const agenda = new Agenda({
	backend: new MongoBackend({
		address: 'mongodb://localhost:27018/agenda',
		collection: 'agendaJobs'
	})
});


await agenda.now('benchmark-job', { to: 'admin@example.com' });
