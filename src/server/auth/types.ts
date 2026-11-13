export type AdminRole = 'owner' | 'moderator' | 'viewer'; export type AdminContext = { uid: string; email: string | null; role: AdminRole; authTime: number }
