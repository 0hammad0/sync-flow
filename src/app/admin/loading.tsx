// While the (shell) layout checks the session, show the same spinner as the
// root loading.tsx, but inside [data-admin-root]: the public header stays
// hidden and the content column is full width from the first paint
// (admin.css), so the shell does not shift the page when it streams in.
export { default } from '../loading';
