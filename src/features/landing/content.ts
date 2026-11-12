/**
 * Landing copy that is also emitted as structured data (FAQPage JSON-LD).
 * Keep every statement true to the code: limits, expiry options, which
 * tools are end-to-end encrypted, and what the optional AI sends.
 */

export const FAQ: { q: string; a: string }[] = [
  {
    q: 'Is SyncFlow free?',
    a: 'Yes. There are no paid plans, no ads and no trackers. SyncFlow is open source under the MIT licence, so you can also run your own copy.',
  },
  {
    q: 'How long are my files kept?',
    a: 'You choose. Without an account a share link expires after 1 hour, 24 hours or 7 days. Signed-in users can also pick 30 days or no expiry, and delete files at any time from My Files. You can add a download limit too. Phone → PC sessions close after 10 minutes, and chat rooms are deleted with everything in them when they expire.',
  },
  {
    q: 'Can you see my files?',
    a: 'Not when end-to-end encryption is on, which is the default for file shares. Your browser encrypts the file with AES-256-GCM and the key stays in the part of the link after the #, which is never sent to our server. If you switch encryption off, or use Phone → PC or chat rooms, content is encrypted in transit and kept in private storage, but our servers can read it.',
  },
  {
    q: 'Do I need an app or an account?',
    a: 'No. Everything runs in the browser on phones and computers. An account is optional: sign in with a one-time email link to keep up to 10 files in My Files and unlock longer expiry.',
  },
  {
    q: 'What is the maximum file size?',
    a: 'Each file can be up to 100 MB, in every tool. A Phone → PC session accepts up to 25 files, which you can download one by one or as a single ZIP.',
  },
  {
    q: 'Are chat rooms end-to-end encrypted?',
    a: 'No. Chat messages and attachments are encrypted in transit (HTTPS) and stored privately until the room expires, but our servers can read them. For something sensitive, share it as an end-to-end encrypted file and post the link in the room.',
  },
  {
    q: 'What does the AI see?',
    a: 'Nothing unless you ask. AI features only exist in chat rooms, only when the person running the server has turned them on, and only run when you click one. Then the text that action needs (recent messages for a catch-up summary or reply ideas, or the one message or code snippet you picked) is sent to OpenRouter and the AI model that answers (or to Google Gemini if OpenRouter is unavailable). Files, file shares and Phone → PC transfers are never sent to AI.',
  },
  {
    q: 'Who builds SyncFlow, and how do I get help?',
    a: 'SyncFlow is an open-source project on GitHub. Questions, bug reports and feature ideas all go to GitHub Issues; there is no separate support email.',
  },
];
