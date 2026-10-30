import {readFile} from 'node:fs/promises';
import path from 'node:path';

type Content = typeof import('../content/en.json');

// Read on every request, so a text saved from the toolbar shows up on reload.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const c: Content = JSON.parse(await readFile(path.join(process.cwd(), 'content/en.json'), 'utf8'));
  return (
    <main>
      <section id="hero">
        <p className="eyebrow">{c.hero.eyebrow}</p>
        <h1>{c.hero.title}</h1>
        <p className="intro">{c.hero.intro}</p>
      </section>
      <section id="services">
        <h2>{c.services.title}</h2>
        <div className="grid">
          {c.services.items.map(s => (
            <article key={s.name}>
              <h3>{s.name}</h3>
              <p>{s.text}</p>
            </article>
          ))}
        </div>
      </section>
      <section id="contact">
        <h2>{c.contact.title}</h2>
        <p>{c.contact.text}</p>
        {/* Lives in the code, not in content/en.json: edit mode offers "Request the change". */}
        <p className="small">© 2026 Studio Norte · Made with care</p>
      </section>
    </main>
  );
}
