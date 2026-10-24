declare module '#auth-utils' {
  interface User {
    id: number
    name: string
    email: string
  }

  interface UserSession {
    adminMode?: boolean
    /** Set between a correct password and a correct emailed code. */
    pendingUserId?: number
  }
}

export {}
