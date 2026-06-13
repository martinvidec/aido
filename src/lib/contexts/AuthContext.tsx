"use client";

import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import { signInWithPopup, GoogleAuthProvider, signOut as firebaseSignOut, onAuthStateChanged } from "firebase/auth";
import { User } from "firebase/auth";
import { auth, db } from "../firebase/firebase";
import { doc, setDoc, getDoc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { upsertPublicProfile, migrateLegacyTodos } from '../firebase/firebaseUtils';
import { useTheme } from './ThemeContext';
import type { Theme as ThemeValue } from './ThemeContext';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Auth debug logs contain UIDs and user-doc contents — keep them out of
// production consoles. NODE_ENV is inlined at build time, so the calls
// compile away in prod bundles.
const debugLog: typeof console.log =
  process.env.NODE_ENV !== 'production' ? console.log.bind(console) : () => {};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const unsubscribeRef = useRef<Unsubscribe | null>(null);
  const router = useRouter();
  const { setTheme } = useTheme();

  useEffect(() => {
    debugLog("Setting up auth state listener");
    const unsubscribeAuthState = onAuthStateChanged(auth, async (authUser) => {
      debugLog("Auth state changed:", authUser ? `User logged in (${authUser.uid})` : "No user");
      if (unsubscribeRef.current) {
        debugLog("Cleaning up previous user doc listener due to auth state change.");
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      
      if (authUser) {
        // Keep the public profile (displayName/photoURL/emailHash — no email)
        // in sync on every login; also lazily migrates existing users.
        upsertPublicProfile(authUser).catch((error) => {
          console.error("Error syncing public profile:", error);
        });

        const userDocRef = doc(db, 'users', authUser.uid);
        try {
          unsubscribeRef.current = onSnapshot(userDocRef, (docSnap) => {
            if (docSnap.exists()) {
              const data = docSnap.data();
              debugLog("User document snapshot received");
              const firestoreTheme = data.theme || 'system';
              debugLog("Setting theme from Firestore snapshot:", firestoreTheme);
              setTheme(firestoreTheme as ThemeValue);

              setUser(authUser);

              // One-time lazy migration of legacy users/{uid}/todos into the
              // spaces model (issue #48). Guarded by a persisted flag + an
              // in-flight lock inside migrateLegacyTodos; safe to skip-call.
              if (!data.todosMigratedToSpacesAt) {
                migrateLegacyTodos(authUser.uid).catch((error) => {
                  console.error("Error migrating legacy todos:", error);
                });
              }
            } else {
              debugLog("User document does not exist, creating...");
              setDoc(userDocRef, {
                email: authUser.email,
                displayName: authUser.displayName,
                photoURL: authUser.photoURL,
                createdAt: new Date(),
                theme: 'system',
                notifications: { email: true, push: true },
                language: 'en',
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              }).then(() => {
                 debugLog("User document created, setting theme to system default.");
                 setTheme('system');
                 setUser(authUser);
              }).catch(creationError => {
                 console.error("Error creating user document:", creationError);
                 setUser(authUser);
              });
            }
            if (loading) setLoading(false);
          }, (error) => {
              console.error("Error in user document snapshot listener:", error);
              setUser(authUser);
              if (loading) setLoading(false);
          });
        } catch (error) {
          console.error("Error setting up user document listener:", error);
          setUser(authUser);
          if (loading) setLoading(false);
        }
      } else {
        setUser(null);
        if (loading) setLoading(false);
      }
    });

    return () => {
      debugLog("Cleaning up auth state listener");
      unsubscribeAuthState();
      if (unsubscribeRef.current) {
        debugLog("Cleaning up user doc listener on component unmount");
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [setTheme, loading]);

  const signInWithGoogle = async () => {
    debugLog("Starting Google sign in process");
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: 'select_account'
    });
    
    try {
      debugLog("Opening Google sign in popup");
      await signInWithPopup(auth, provider);
      debugLog("Sign in successful");
    } catch (error: any) {
      console.error("Error signing in with Google:", error);
      if (error.code === 'auth/popup-closed-by-user') {
        debugLog("User closed the popup");
      } else if (error.code === 'auth/cancelled-popup-request') {
        debugLog("Sign in was cancelled");
      } else {
        console.error("Unknown error during sign in:", error.message);
      }
    }
  };

  const signOutUser = async () => {
    try {
      debugLog("Starting sign out process");
      if (unsubscribeRef.current) {
        debugLog("Cleaning up user doc listener before sign out");
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      await firebaseSignOut(auth);
      debugLog("Sign out successful, redirecting to login page...");
      router.push('/login');
    } catch (error: any) {
      console.error("Error signing out:", error.message);
    }
  };

  const value = {
    user,
    loading,
    signInWithGoogle,
    signOut: signOutUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export { AuthContext };
