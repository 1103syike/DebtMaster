import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { initializeApp } from 'firebase/app';

import { AppComponent } from './app/app.component';
import { firebaseConfig } from './environments/firebase-config';

initializeApp(firebaseConfig);

bootstrapApplication(AppComponent, {
  providers: [provideAnimations()],
}).catch((err) => console.error(err));
