class UserService {
  constructor() {
    this.users = [];
  }

  async getAllUsers() {
    return this.users;
  }

  async getUserById(id) {
    return this.users.find((user) => user.id === id);
  }

  async createUser(userData) {
    const newUser = { id: Date.now().toString(), ...userData };
    this.users.push(newUser);
    return newUser;
  }

  async updateUser(id, userData) {
    const userIndex = this.users.findIndex((user) => user.id === id);
    if (userIndex !== -1) {
      this.users[userIndex] = { ...this.users[userIndex], ...userData };
      return this.users[userIndex];
    }
    throw new Error("User not found");
  }

  async deleteUser(id) {
    const userIndex = this.users.findIndex((user) => user.id === id);
    if (userIndex !== -1) {
      return this.users.splice(userIndex, 1)[0];
    }
    throw new Error("User not found");
  }
}