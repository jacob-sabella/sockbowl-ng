

export class JoinGameRequest {
  joinCode: string;
  name: string;

  constructor(
    joinCode: string = '',
    name: string = ''
  ) {
    this.joinCode = joinCode;
    this.name = name;
  }
}
