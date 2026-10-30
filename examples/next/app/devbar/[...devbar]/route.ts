import {jsonAdapter} from 'devbar/adapters/json';
import {createDevbarHandler} from 'devbar/server';

// Every devbar endpoint (/devbar/feedback, /devbar/edit, /devbar/file). Outside `next dev` they answer 404.
export const {GET, POST, PATCH, DELETE} = createDevbarHandler({
  content: jsonAdapter({files: ['content/en.json'], scope: {'hero.': '#hero', 'services.': '#services', 'contact.': '#contact'}}),
});
