import { importProvidersFrom } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';

import { AppComponent } from './app/app.component';
import { firebaseConfig } from './environments/firebase-config';

bootstrapApplication(AppComponent, {
  providers: [
    provideAnimations(),
    importProvidersFrom(
      provideFirebaseApp(() => initializeApp(firebaseConfig)),
      provideAuth(() => getAuth()),
      provideFirestore(() => getFirestore()),
    ),
  ],
}).catch((err) => console.error(err));
