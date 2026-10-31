import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Discord Ticket AI Assistant — Admin Dashboard',
  description:
    'Administrative control plane for the AI-Powered Discord Ticket Conversation Assistant.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" style={{ colorScheme: 'dark' }}>
      <body className="min-h-screen bg-background text-foreground antialiased selection:bg-primary/20 selection:text-primary">
        {children}
      </body>
    </html>
  );
}

