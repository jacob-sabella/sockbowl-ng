export class GameSessionIdentifiers {
  id: string;
  joinCode: string;

  constructor(id: string = '', joinCode: string = '') {
    this.id = id;
    this.joinCode = joinCode;
  }
}
