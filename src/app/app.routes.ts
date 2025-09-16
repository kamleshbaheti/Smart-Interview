import { Routes } from '@angular/router';
import { Join } from './components/join/join';
import { Report } from './components/report/report';
import { Home } from './components/home/home';
import { Room } from './components/room/room';

export const routes: Routes = [
    {path: '', component: Home},
    {path: 'join', component: Join, title: 'Join Interview'},
    { path: 'room/:sessionId/:role/:name', component: Room, title: 'Interview Room' },
    { path: 'report/:sessionId', component: Report, title: 'Interview Report'},
    { path: '**', redirectTo: '' }
];
