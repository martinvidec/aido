'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { 
  sendContactRequest, 
  getOutgoingContactRequests, 
  OutgoingRequest, 
  getIncomingContactRequests,
  IncomingRequest,
  acceptContactRequest,
  rejectContactRequest,
  getContacts, Contact,
  cancelOutgoingRequest
} from '@/lib/firebase/firebaseUtils';
import { useError } from '@/lib/hooks/useError';
import Image from 'next/image';
import Link from 'next/link';
import { FaCheckCircle, FaTimesCircle, FaPaperPlane, FaSpinner, FaUsers, FaEnvelope } from 'react-icons/fa';

export default function ContactsPage() {
  const { user } = useAuth();
  const { reportError } = useError();

  const [targetEmail, setTargetEmail] = useState('');
  const [isLoadingSend, setIsLoadingSend] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [outgoingRequests, setOutgoingRequests] = useState<OutgoingRequest[]>([]);
  const [loadingOutgoing, setLoadingOutgoing] = useState(true);

  const [incomingRequests, setIncomingRequests] = useState<IncomingRequest[]>([]);
  const [loadingIncoming, setLoadingIncoming] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);

  const fetchAllContactData = useCallback(async () => {
    if (!user?.uid) return;
    setLoadingOutgoing(true);
    setLoadingIncoming(true);
    setLoadingContacts(true);
    try {
      const [outReqs, inReqs, contactList] = await Promise.all([
        getOutgoingContactRequests(user.uid),
        getIncomingContactRequests(user.uid),
        getContacts(user.uid)
      ]);
      setOutgoingRequests(outReqs);
      setIncomingRequests(inReqs);
      setContacts(contactList);
    } catch (err) {
      console.error("Failed to load contact data:", err);
      setMessage({ type: 'error', text: 'Could not load your contact data.' });
    } finally {
      setLoadingOutgoing(false);
      setLoadingIncoming(false);
      setLoadingContacts(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    fetchAllContactData();
  }, [fetchAllContactData]);

  const handleSendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setMessage({ type: 'error', text: 'Please sign in to send contact requests.' });
      return;
    }
    if (!targetEmail.trim()) {
      setMessage({ type: 'error', text: 'Please enter an email address.' });
      return;
    }

    setIsLoadingSend(true);
    setMessage(null);

    try {
      const result = await sendContactRequest(targetEmail.trim());
      setMessage({ type: 'success', text: result.message });
      if (result.status === 'invited' || result.status === 'request_sent' || result.status === 'contact_added') {
        setTargetEmail('');
        fetchAllContactData();
      }
    } catch (error: any) {
      console.error("Error sending contact request or invite:", error);
      setMessage({ type: 'error', text: error.message || 'Failed to process request.' });
    } finally {
      setIsLoadingSend(false);
    }
  };

  const handleAcceptRequest = async (requester: IncomingRequest) => {
    if (!user?.uid) return;
    setActionLoading(prev => ({ ...prev, [requester.id]: true }));
    try {
      await acceptContactRequest(user.uid, requester.id, {
        email: requester.requesterEmail,
        displayName: requester.requesterDisplayName,
        photoURL: requester.requesterPhotoURL,
      });
      setMessage({ type: 'success', text: `Accepted contact request from ${requester.requesterDisplayName || requester.requesterEmail}.`});
      fetchAllContactData();
    } catch (error: any) {
      console.error("Error accepting contact request:", error);
      setMessage({ type: 'error', text: error.message || 'Failed to accept request.'});
    } finally {
      setActionLoading(prev => ({ ...prev, [requester.id]: false }));
    }
  };

  const handleRejectRequest = async (requesterId: string) => {
    if (!user?.uid) return;
    setActionLoading(prev => ({ ...prev, [requesterId]: true }));
    try {
      await rejectContactRequest(user.uid, requesterId);
      setMessage({ type: 'success', text: `Rejected contact request.`});
      fetchAllContactData();
    } catch (error: any) {
      console.error("Error rejecting contact request:", error);
      setMessage({ type: 'error', text: error.message || 'Failed to reject request.'});
    } finally {
      setActionLoading(prev => ({ ...prev, [requesterId]: false }));
    }
  };

  const handleCancelOutgoingRequest = async (requestId: string, isInvite: boolean) => {
    if (!user?.uid) {
      setMessage({ type: 'error', text: 'You must be logged in to cancel a request.' });
      return;
    }
    setActionLoading(prev => ({ ...prev, [requestId]: true }));
    setMessage(null);
    try {
      const result = await cancelOutgoingRequest(user.uid, requestId, isInvite);
      setMessage({ type: 'success', text: result.message });
      fetchAllContactData(); // Refresh lists
    } catch (error: any) {
      console.error("Error canceling outgoing request/invite:", error);
      setMessage({ type: 'error', text: error.message || 'Failed to cancel request/invite.' });
    } finally {
      setActionLoading(prev => ({ ...prev, [requestId]: false }));
    }
  };

  return (
    <div className="container mx-auto p-4 md:p-8 max-w-4xl">
      <Link href="/todos" className="mb-4 inline-block text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100">
        ← Zurück zu aido
      </Link>
      <h1 className="text-3xl font-bold mb-8 text-gray-900 dark:text-gray-100">Kontakte und Anfragen</h1>

      <section className="mb-12 p-6 bg-white dark:bg-gray-800 shadow-md rounded-lg">
        <h2 className="text-2xl font-semibold mb-6 text-gray-800 dark:text-gray-200">Neue Kontaktanfrage senden</h2>
        <form onSubmit={handleSendRequest} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              E-Mail-Adresse des Kontakts
            </label>
            <input
              type="email"
              id="email"
              value={targetEmail}
              onChange={(e) => setTargetEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 dark:bg-gray-700 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
              required
            />
          </div>
          <button
            type="submit"
            disabled={isLoadingSend}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoadingSend ? (
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              'Anfrage senden'
            )}
          </button>
        </form>
        {message && (
          <div className={`mt-4 p-3 rounded-md text-sm ${message.type === 'success' ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-200' : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200'}`}>
            {message.text}
          </div>
        )}
      </section>

      <section className="mb-12 p-6 bg-white dark:bg-gray-800 shadow-md rounded-lg">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-200">Meine Kontakte ({contacts.length})</h2>
        </div>
        {loadingContacts ? (
          <div className="flex justify-center items-center py-4">
            <FaSpinner className="animate-spin text-2xl text-blue-500" />
            <p className="ml-2 text-gray-600 dark:text-gray-400">Lade Kontakte...</p>
          </div>
        ) : contacts.length === 0 ? (
          <p className="text-gray-600 dark:text-gray-400 text-center py-4">Du hast noch keine Kontakte.</p>
        ) : (
          <ul className="space-y-4">
            {contacts.map(contact => (
              <li key={contact.uid} className="p-4 border border-gray-200 dark:border-gray-700 rounded-md flex items-center justify-between gap-3">
                <div className="flex items-center flex-grow min-w-0">
                  {contact.photoURL ? (
                    <Image src={contact.photoURL} alt={contact.displayName || contact.email || 'Avatar'} width={40} height={40} className="rounded-full mr-4 flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center mr-4 flex-shrink-0 text-gray-500 dark:text-gray-400">
                      {(contact.displayName || contact.email || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {contact.displayName || 'N/A'}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                      {contact.email || 'Keine E-Mail'}
                    </p>
                     <p className="text-xs text-gray-400 dark:text-gray-500">
                      Kontakt seit: {new Date(contact.addedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-12 p-6 bg-white dark:bg-gray-800 shadow-md rounded-lg">
        <h2 className="text-2xl font-semibold mb-6 text-gray-800 dark:text-gray-200">Eingehende Anfragen ({incomingRequests.length})</h2>
        {loadingIncoming ? (
          <p className="text-gray-600 dark:text-gray-400">Lade eingehende Anfragen...</p>
        ) : incomingRequests.length === 0 ? (
          <p className="text-gray-600 dark:text-gray-400">Keine eingehenden Anfragen gefunden.</p>
        ) : (
          <ul className="space-y-4">
            {incomingRequests.map(req => (
              <li key={req.id} className="p-4 border border-gray-200 dark:border-gray-700 rounded-md flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center">
                  {req.requesterPhotoURL ? (
                    <Image src={req.requesterPhotoURL} alt={req.requesterDisplayName || req.requesterEmail || 'Avatar'} width={40} height={40} className="rounded-full mr-3" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center mr-3 text-gray-500 dark:text-gray-400">
                      {(req.requesterDisplayName || req.requesterEmail || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {req.requesterDisplayName || req.requesterEmail || req.id}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      Empfangen: {new Date(req.requestedAt).toLocaleDateString()} {new Date(req.requestedAt).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
                <div className="flex space-x-2 flex-shrink-0">
                  <button 
                    onClick={() => handleAcceptRequest(req)}
                    disabled={actionLoading[req.id]}
                    className="px-3 py-1 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 flex items-center"
                  >
                    {actionLoading[req.id] ? <FaSpinner className="animate-spin mr-1" /> : <FaCheckCircle className="mr-1" />} Annahmen
                  </button>
                  <button 
                    onClick={() => handleRejectRequest(req.id)}
                    disabled={actionLoading[req.id]}
                    className="px-3 py-1 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 flex items-center"
                  >
                    {actionLoading[req.id] ? <FaSpinner className="animate-spin mr-1" /> : <FaTimesCircle className="mr-1" />} Ablehnen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="p-6 bg-white dark:bg-gray-800 shadow-md rounded-lg">
        <h2 className="text-2xl font-semibold mb-6 text-gray-800 dark:text-gray-200">Ausgehende Anfragen ({outgoingRequests.length})</h2>
        {loadingOutgoing ? (
          <p className="text-gray-600 dark:text-gray-400">Lade ausgehende Anfragen...</p>
        ) : outgoingRequests.length === 0 ? (
          <p className="text-gray-600 dark:text-gray-400">Keine ausgehenden Anfragen gefunden.</p>
        ) : (
          <ul className="space-y-4">
            {outgoingRequests.map(req => (
              <li key={req.id} className="p-4 border border-gray-200 dark:border-gray-700 rounded-md flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center min-w-0">
                  {req.status === 'invited' ? (
                    <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-500 flex items-center justify-center mr-3 text-gray-500 dark:text-gray-300 flex-shrink-0">
                      <FaEnvelope />
                    </div>
                  ) : req.targetUser?.photoURL ? (
                    <Image src={req.targetUser.photoURL} alt={req.targetUser.displayName || req.targetUser.email || 'Avatar'} width={40} height={40} className="rounded-full mr-3 flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center mr-3 text-gray-500 dark:text-gray-400 flex-shrink-0">
                      {((req.targetUser?.displayName || req.targetUser?.email) || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {req.status === 'invited' 
                        ? (req.targetEmail || 'E-Mail Einladung') 
                        : (req.targetUser?.displayName || req.targetUser?.email || req.id)}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Status: <span className={`font-semibold ${ 
                        req.status === 'pending' ? 'text-yellow-600 dark:text-yellow-400' : 
                        req.status === 'invited' ? 'text-blue-600 dark:text-blue-400' :
                        req.status === 'accepted' ? 'text-green-600 dark:text-green-400' :
                        req.status === 'rejected' ? 'text-red-600 dark:text-red-400' :
                        'text-gray-600 dark:text-gray-300'}`}>
                          {req.status === 'invited' ? 'Eingeladen' : req.status}
                        </span>
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {req.status === 'invited' ? 'Eingeladen am' : 'Gesendet am'}: {new Date(req.requestedAt).toLocaleDateString()} {new Date(req.requestedAt).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
                
                {(req.status === 'pending' || req.status === 'invited') && (
                    <button 
                        onClick={() => handleCancelOutgoingRequest(req.id, req.status === 'invited')}
                        disabled={actionLoading[req.id]} 
                        className="ml-auto px-3 py-1 text-xs font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-50 flex items-center flex-shrink-0"
                    >
                        {actionLoading[req.id] ? <FaSpinner className="animate-spin mr-1" /> : null} 
                        Zurückziehen
                    </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

    </div>
  );
} 