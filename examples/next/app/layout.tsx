import {Devbar} from 'devbar';
import './globals.css';

export const metadata = {title: 'devbar example'};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body>
        {children}
        {process.env.NODE_ENV === 'development' && <Devbar />}
      </body>
    </html>
  );
}
