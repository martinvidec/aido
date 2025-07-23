# Aido - Advanced Todo Management Platform

Aido is a sophisticated, collaborative todo management application that combines traditional task management with modern features like real-time collaboration, voice recording, AI integration, and rich text editing. Built with Next.js 15 and Firebase, it offers a seamless experience for personal and team productivity.

## 🚀 Core Features

### 📝 Advanced Todo Management
- **Create, Edit, Delete Todos**: Full CRUD operations with real-time updates
- **Rich Text Editor**: Powered by TipTap with extensive formatting capabilities
- **Task Completion**: Mark todos as done/undone with visual feedback
- **Image Attachments**: Upload and attach images to todos
- **Real-time Sync**: Changes sync instantly across all devices

### 👥 Social & Collaboration Features
- **Todo Sharing**: Share todos with contacts and collaborate in real-time
- **User Mentions**: Mention other users in todos using @username syntax
- **Contact Management**: Send, accept, and manage contact requests
- **Mentions Dashboard**: View all todos where you've been mentioned
- **User Search**: Find and connect with other users
- **Contact System**: Organized contact lists with status tracking

### 🎤 Voice & AI Integration
- **Voice Recording**: Record voice notes with real-time transcription
- **Deepgram Integration**: High-quality speech-to-text conversion
- **AI Chat Endpoints**: Integration with multiple AI providers
  - OpenAI GPT models
  - Anthropic Claude
  - Replicate models
- **Real-time Transcription**: Live voice-to-text during recording

### ✨ Rich Text Editing (TipTap)
- **Formatting Tools**: Bold, italic, underline, strikethrough
- **Lists**: Ordered and unordered lists with nesting
- **Task Lists**: Interactive checkboxes within content
- **Hashtags**: Automatic hashtag detection and styling (#hashtag)
- **Mentions**: User mention functionality (@username)
- **Links**: Hyperlink support with automatic detection
- **Highlights**: Text highlighting for emphasis
- **Placeholders**: Contextual placeholder text
- **Keyboard Shortcuts**: Full keyboard navigation support

### 🎨 User Experience
- **Dark/Light Themes**: System preference detection with manual toggle
- **Responsive Design**: Mobile-first design that works on all devices
- **Loading States**: Smooth loading animations with Framer Motion
- **Error Handling**: Comprehensive error reporting and user feedback
- **Breadcrumb Navigation**: Clear navigation hierarchy
- **User Profiles**: Customizable profiles with Google Avatar integration
- **Emoji Support**: Emoji picker integration for enhanced expression

## 🏗️ Technical Architecture

### Frontend Stack
- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript throughout the application
- **Styling**: TailwindCSS with dark mode support
- **State Management**: React Context API with custom hooks
- **Animations**: Framer Motion for smooth transitions
- **Icons**: Lucide React and React Icons
- **Rich Text**: TipTap editor with custom extensions

### Backend & Services
- **Database**: Firebase Firestore with real-time listeners
- **Authentication**: Firebase Auth with Google Sign-In
- **Storage**: Firebase Storage for image uploads
- **Functions**: Firebase Cloud Functions (in `/functions` directory)
- **Voice**: Deepgram API for speech recognition
- **AI Services**: Vercel AI SDK with multiple providers

### Key Libraries & Tools
- **@tiptap/react**: Rich text editing
- **@deepgram/sdk**: Voice transcription
- **@ai-sdk/***: AI model integrations
- **firebase**: Backend services
- **framer-motion**: Animations
- **emoji-picker-react**: Emoji selection
- **lucide-react**: Icon system

## 📁 Project Structure

```
src/
├── app/                      # Next.js App Router
│   ├── (protected)/         # Protected routes
│   │   ├── contacts/        # Contact management
│   │   ├── mentions/        # Mentions dashboard
│   │   ├── settings/        # User settings
│   │   └── todos/           # Todo management
│   ├── api/                 # API endpoints
│   │   ├── anthropic/       # Claude AI integration
│   │   ├── deepgram/        # Voice API
│   │   ├── openai/          # GPT integration
│   │   └── replicate/       # Replicate models
│   ├── login/               # Authentication pages
│   └── layout.tsx           # Root layout
├── components/              # React components
│   ├── Todo.tsx            # Individual todo item
│   ├── TodoList.tsx        # Todo list container
│   ├── TiptapToolbar.tsx   # Editor toolbar
│   ├── VoiceRecorder.tsx   # Voice recording
│   ├── MentionsList.tsx    # Mentions dashboard
│   ├── ShareTodo.tsx       # Sharing functionality
│   ├── UserProfile.tsx     # User profile display
│   └── ...                 # More components
├── lib/                    # Utilities and configurations
│   ├── contexts/           # React contexts
│   ├── firebase/           # Firebase configuration
│   ├── hooks/              # Custom React hooks
│   ├── tiptap/             # TipTap extensions
│   └── utils/              # Utility functions
└── globals.css             # Global styles
```

## 🔧 Available Pages & Routes

### Public Routes
- `/login` - Authentication page with Google Sign-In

### Protected Routes (requires authentication)
- `/` - Main dashboard with todo list
- `/contacts` - Contact management and friend requests
- `/mentions` - View todos where you're mentioned
- `/settings` - User preferences and account settings

### API Endpoints
- `/api/deepgram` - Voice transcription service
- `/api/anthropic/chat` - Claude AI chat (currently disabled)
- `/api/openai/chat` - OpenAI GPT integration
- `/api/replicate/chat` - Replicate model access

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm
- Firebase project with Firestore, Auth, and Storage enabled
- Deepgram API key (for voice features)
- Optional: OpenAI, Anthropic, or Replicate API keys

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/martinvidec/aido.git
   cd aido
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   ```bash
   cp .env.example .env.local
   ```
   
   Configure your environment variables:
   ```env
   # Firebase Configuration
   NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_domain
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_bucket
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
   
   # Deepgram for voice features
   DEEPGRAM_API_KEY=your_deepgram_key
   
   # Optional AI providers
   OPENAI_API_KEY=your_openai_key
   ANTHROPIC_API_KEY=your_anthropic_key
   REPLICATE_API_TOKEN=your_replicate_token
   ```

4. **Firebase Setup**
   - Create a new Firebase project
   - Enable Authentication with Google provider
   - Set up Firestore database
   - Configure Storage for image uploads
   - Deploy security rules from `firestore.rules`

5. **Run the development server**
   ```bash
   npm run dev
   ```

6. **Open your browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

## 💡 Usage Examples

### Creating a Todo with Mentions
1. Click "Add Todo" or use the main input
2. Type your todo content
3. Mention users with `@username` syntax
4. Add hashtags with `#tag` syntax
5. Attach images if needed
6. Save and share with contacts

### Voice Recording
1. Click the microphone icon in the voice recorder
2. Speak your todo content
3. Real-time transcription appears
4. Stop recording to save as a new todo

### Managing Contacts
1. Go to `/contacts` page
2. Send contact requests by email
3. Accept/reject incoming requests
4. View your contact list
5. Share todos with contacts

## 🔒 Security Features

- **Authentication**: Firebase Auth with Google Sign-In
- **Authorization**: Route protection and user-based access control
- **Data Security**: Firestore security rules for data protection
- **Input Validation**: Client and server-side validation
- **Error Handling**: Comprehensive error reporting and user feedback

## 🎯 Key Components

### TodoList Component
- Real-time todo loading and updates
- Filtering and search capabilities
- Drag and drop support (planned)
- Bulk operations (planned)

### TipTap Editor
- Custom mention extension with user search
- Hashtag extension with automatic styling
- Image upload integration
- Keyboard shortcuts and accessibility

### Voice Recording
- Real-time transcription with Deepgram
- Audio waveform visualization
- Automatic todo creation from transcripts

### Contact System
- Friend request management
- User discovery and search
- Contact status tracking
- Privacy controls

## 🔮 Planned Features

- [ ] Drag and drop todo reordering
- [ ] Todo categories and labels
- [ ] Due dates and reminders
- [ ] Team workspaces
- [ ] Advanced search and filtering
- [ ] Mobile app (React Native)
- [ ] Offline support with sync
- [ ] Calendar integration
- [ ] Export functionality

## 🛠️ Development

### Scripts
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
```

### Code Style
- TypeScript for type safety
- ESLint for code quality
- Prettier for formatting (recommended)
- Component-based architecture
- Custom hooks for reusable logic

## 📄 License

This project is based on the template from https://github.com/martinvidec/template-cursor-nextjs-firebase

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## 📞 Support

For issues and questions:
- Create an issue on GitHub
- Check the documentation
- Review the code comments and examples

---

*Aido - Making productivity collaborative and intelligent.*
