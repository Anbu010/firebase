import { inject, Injectable, OnDestroy } from '@angular/core';
import {
  Auth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  user,
  User,
} from '@angular/fire/auth';
import { map, Observable, Subscription } from 'rxjs';
import {
  doc,
  docData,
  DocumentReference,
  Firestore,
  setDoc,
  addDoc,
  deleteDoc,
  collection,
  collectionData,
  serverTimestamp,
  query,
  orderBy,
  limit,
  DocumentData,
  FieldValue,
} from '@angular/fire/firestore';
import {
  Storage,
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from '@angular/fire/storage';
import { getToken, Messaging } from '@angular/fire/messaging';
import { Router } from '@angular/router';

type ChatMessage = {
  name: string | null,
  profilePicUrl: string | null,
  timestamp: FieldValue,
  uid: string | null,
  text?: string,
  imageUrl?: string
};

@Injectable({
  providedIn: 'root',
})
export class ChatService implements OnDestroy {
  firestore: Firestore = inject(Firestore);
  auth: Auth = inject(Auth);
  storage: Storage = inject(Storage);
  messaging: Messaging = inject(Messaging);
  router: Router = inject(Router);
  private provider = new GoogleAuthProvider();
  LOADING_IMAGE_URL = 'https://www.google.com/images/spin-32.gif?a';

  // Observable that is updated when the auth state changes
  user$ = user(this.auth);
  currentUser: User | null = this.auth.currentUser;
  userSubscription: Subscription;

  constructor() {
    this.userSubscription = this.user$.subscribe((aUser: User | null) => {
      this.currentUser = aUser;
    });
  }

  ngOnDestroy(): void {
    if (this.userSubscription) {
      this.userSubscription.unsubscribe();
    }
  }

  // Login to Friendly Chat
  login() {
    signInWithPopup(this.auth, this.provider).then((result) => {
      const credential = GoogleAuthProvider.credentialFromResult(result);
      this.router.navigate(['/', 'chat']);
      return credential;
    }).catch((error) => {
      console.error('Login error: ', error);
    });
  }

  // Logout of Friendly Chat
  logout() {
    signOut(this.auth).then(() => {
      this.router.navigate(['/', 'login']);
      console.log('Signed out');
    }).catch((error) => {
      console.error('Sign out error: ', error);
    });
  }

  // Adds a text or image message to Cloud Firestore
  addMessage = async (
    textMessage: string | null,
    imageUrl: string | null,
  ): Promise<void | DocumentReference<DocumentData>> => {
    if (!textMessage && !imageUrl) {
      console.log("addMessage was called without a message", textMessage, imageUrl);
      return;
    }

    if (this.currentUser === null) {
      console.log("addMessage requires a signed-in user");
      return;
    }

    const message: ChatMessage = {
      name: this.currentUser.displayName,
      profilePicUrl: this.currentUser.photoURL,
      timestamp: serverTimestamp(),
      uid: this.currentUser?.uid,
    };

    textMessage && (message.text = textMessage);
    imageUrl && (message.imageUrl = imageUrl);

    try {
      const newMessageRef = await addDoc(
        collection(this.firestore, "messages"),
        message,
      );
      return newMessageRef;
    } catch (error) {
      console.error("Error writing new message to Firebase Database", error);
      return;
    }
  };

  // Saves a new text message to Cloud Firestore
  saveTextMessage = async (messageText: string) => {
    return this.addMessage(messageText, null);
  };

  // Loads chat messages history and listens for upcoming ones
  loadMessages = (): Observable<ChatMessage[]> => {
    const messagesCollection = collection(this.firestore, 'messages');
    const messagesQuery = query(messagesCollection, orderBy('timestamp', 'desc'), limit(50));
    return collectionData(messagesQuery, { idField: 'id' }) as Observable<ChatMessage[]>;
  };

  // Saves a new message containing an image in Firebase Storage
  saveImageMessage = async (file: File) => {
    if (!this.currentUser) {
      console.error("User not logged in");
      return;
    }
    const filePath = `${this.currentUser.uid}/${file.name}`;
    const fileRef = ref(this.storage, filePath);
    const uploadTask = uploadBytesResumable(fileRef, file);

    uploadTask.on('state_changed', 
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        console.log('Upload is ' + progress + '% done');
      }, 
      (error) => {
        console.error("Image upload failed: ", error);
      }, 
      () => {
        getDownloadURL(uploadTask.snapshot.ref).then((downloadURL) => {
          this.addMessage(null, downloadURL);
        });
      }
    );
  };

  async updateData(path: string, data: any) {
    try {
      await setDoc(doc(this.firestore, path), data, { merge: true });
    } catch (error) {
      console.error("Error updating document: ", error);
    }
  }

  async deleteData(path: string) {
    try {
      await deleteDoc(doc(this.firestore, path));
    } catch (error) {
      console.error("Error deleting document: ", error);
    }
  }

  getDocData(path: string): Observable<DocumentData | undefined> {
    const docRef = doc(this.firestore, path);
    return docData(docRef);
  }

  getCollectionData(path: string): Observable<DocumentData[]> {
    const collectionRef = collection(this.firestore, path);
    return collectionData(collectionRef, { idField: 'id' });
  }

  async uploadToStorage(
    path: string,
    input: HTMLInputElement,
    contentType: any
  ) {
    const file = input.files?.[0];
    if (!file) {
      console.error("No file selected for upload");
      return;
    }
    const storageRef = ref(this.storage, path);
    try {
      await uploadBytesResumable(storageRef, file, { contentType });
      const downloadURL = await getDownloadURL(storageRef);
      return downloadURL;
    } catch (error) {
      console.error("Error uploading file: ", error);
      return null;
    }
  }

  // Requests permissions to show notifications
  requestNotificationsPermissions = async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        console.log('Notification permission granted.');
      } else {
        console.log('Notification permission denied.');
      }
    } catch (error) {
      console.error('Unable to get permission to notify.', error);
    }
  };

  saveMessagingDeviceToken = async () => {
    try {
      const currentToken = await getToken(this.messaging);
      if (currentToken) {
        console.log('Got FCM device token:', currentToken);
        await setDoc(doc(this.firestore, 'fcmTokens', currentToken), { uid: this.currentUser?.uid });
      } else {
        console.log('No registration token available. Request permission to generate one.');
      }
    } catch (error) {
      console.error('Unable to get messaging token.', error);
    }
  };
}
