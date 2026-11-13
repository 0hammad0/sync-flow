// A soft navigation back to /admin/files (a link, not router.back) must close
// the drawer: without a match here the slot would keep showing the last file.
export default function FilesDrawerClosed() {
  return null;
}
