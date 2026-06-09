"use client";

import { useState, useEffect, useRef } from 'react';
import { findUserByEmail, searchUsersByDisplayName } from '@/lib/firebase/firebaseUtils';
import Image from 'next/image';

interface User {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

interface UserSearchProps {
  onSelect: (user: User) => void;
  excludeUsers?: string[];
}

export default function UserSearch({ onSelect, excludeUsers = [] }: UserSearchProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const searchUsers = async () => {
      if (searchTerm.length < 2) {
        setUsers([]);
        return;
      }

      setIsLoading(true);
      try {
        const foundUsers = new Map<string, User>();

        if (searchTerm.includes('@')) {
          // E-Mail: nur Exact-Match über den Hash — kein Präfix-Scan, damit
          // die Nutzerbasis nicht enumeriert werden kann.
          const profile = await findUserByEmail(searchTerm);
          if (profile && !excludeUsers.includes(profile.uid)) {
            foundUsers.set(profile.uid, {
              uid: profile.uid,
              displayName: profile.displayName,
              email: searchTerm.trim().toLowerCase(),
              photoURL: profile.photoURL,
            });
          }
        } else {
          // Suche nach Anzeigenamen über die öffentlichen Profile (ohne E-Mail)
          const profiles = await searchUsersByDisplayName(searchTerm, 5);
          profiles.forEach(profile => {
            if (!excludeUsers.includes(profile.uid)) {
              foundUsers.set(profile.uid, {
                uid: profile.uid,
                displayName: profile.displayName,
                email: null,
                photoURL: profile.photoURL,
              });
            }
          });
        }

        setUsers(Array.from(foundUsers.values()));
      } catch (error) {
        console.error('Error searching users:', error);
        setUsers([]);
      } finally {
        setIsLoading(false);
      }
    };

    const debounceTimer = setTimeout(searchUsers, 300);
    return () => clearTimeout(debounceTimer);
  }, [searchTerm, excludeUsers]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (user: User) => {
    onSelect(user);
    setSearchTerm('');
    setShowDropdown(false);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (searchTerm.includes('@')) {
        // Wenn es eine E-Mail-Adresse ist, erstelle einen temporären Benutzer
        const tempUser: User = {
          uid: searchTerm,
          email: searchTerm,
          displayName: null,
          photoURL: null
        };
        handleSelect(tempUser);
      } else if (users.length > 0) {
        // Wenn es Suchergebnisse gibt, wähle den ersten Benutzer aus
        handleSelect(users[0]);
      }
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex items-center space-x-2">
        <input
          ref={inputRef}
          type="text"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setShowDropdown(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Enter email or search for users..."
          className="flex-1 p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
        />
        <button
          onClick={() => {
            if (searchTerm.includes('@')) {
              const tempUser: User = {
                uid: searchTerm,
                email: searchTerm,
                displayName: null,
                photoURL: null
              };
              handleSelect(tempUser);
            }
          }}
          disabled={!searchTerm.includes('@')}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>
      
      {showDropdown && (searchTerm.length >= 2 || isLoading) && (
        <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-auto">
          {isLoading ? (
            <div className="p-2 text-center text-gray-500">Loading...</div>
          ) : users.length === 0 ? (
            <div className="p-2 text-center text-gray-500">
              {searchTerm.includes('@') 
                ? "Press 'Add' or Enter to share with this email"
                : "No users found. Try searching by email."}
            </div>
          ) : (
            users.map((user) => (
              <button
                key={user.uid}
                onClick={() => handleSelect(user)}
                className="w-full p-2 hover:bg-gray-100 flex items-center space-x-2"
              >
                {user.photoURL ? (
                  <Image
                    src={user.photoURL}
                    alt={user.displayName || 'User avatar'}
                    width={24}
                    height={24}
                    className="rounded-full"
                  />
                ) : (
                  <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center">
                    <span className="text-xs text-gray-500">
                      {user.displayName?.[0] || user.email?.[0] || '?'}
                    </span>
                  </div>
                )}
                <span className="text-sm text-gray-900">
                  {user.displayName || user.email}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
} 