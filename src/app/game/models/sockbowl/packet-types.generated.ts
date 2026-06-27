export type Maybe<T> = T;
export type InputMaybe<T> = T;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

/** Bonus Node */
export type Bonus = {
  bonusParts: Maybe<Array<Maybe<HasBonusPart>>>;
  id: Scalars['ID']['output'];
  preamble: Maybe<Scalars['String']['output']>;
  subcategory: Maybe<Subcategory>;
};

/** BonusPart Node */
export type BonusPart = {
  answer: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  question: Maybe<Scalars['String']['output']>;
};

/** Category Node */
export type Category = {
  id: Scalars['ID']['output'];
  name: Maybe<Scalars['String']['output']>;
};

/** Relationship from Packet -> Bonus */
export type ContainsBonus = {
  bonus: Maybe<Bonus>;
  id: Scalars['ID']['output'];
  order: Maybe<Scalars['Int']['output']>;
};

/** Relationship from Packet -> Tossup */
export type ContainsTossup = {
  id: Scalars['ID']['output'];
  order: Maybe<Scalars['Int']['output']>;
  tossup: Maybe<Tossup>;
};

/** Difficulty Node */
export type Difficulty = {
  id: Scalars['ID']['output'];
  name: Maybe<Scalars['String']['output']>;
};

/** Event Node */
export type Event = {
  id: Scalars['ID']['output'];
  imported: Maybe<Scalars['Boolean']['output']>;
  location: Maybe<Scalars['String']['output']>;
  name: Maybe<Scalars['String']['output']>;
  packets: Maybe<Array<Maybe<UsesPacketAtRound>>>;
  year: Maybe<Scalars['Int']['output']>;
};

/** Relationship from Bonus -> BonusPart */
export type HasBonusPart = {
  bonusPart: Maybe<BonusPart>;
  id: Scalars['ID']['output'];
  order: Maybe<Scalars['Int']['output']>;
};

/** Packet Node */
export type Packet = {
  bonuses: Maybe<Array<Maybe<ContainsBonus>>>;
  difficulty: Maybe<Difficulty>;
  id: Scalars['ID']['output'];
  name: Maybe<Scalars['String']['output']>;
  tossups: Maybe<Array<Maybe<ContainsTossup>>>;
};

export type Query = {
  getAllPackets: Array<Packet>;
  getPacketById: Maybe<Packet>;
  searchPacketsByName: Array<Packet>;
};


export type QueryGetPacketByIdArgs = {
  id: Scalars['ID']['input'];
};


export type QuerySearchPacketsByNameArgs = {
  name: Scalars['String']['input'];
};

/** Subcategory Node */
export type Subcategory = {
  category: Maybe<Category>;
  id: Scalars['ID']['output'];
  name: Maybe<Scalars['String']['output']>;
};

/** Tossup Node */
export type Tossup = {
  answer: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  question: Maybe<Scalars['String']['output']>;
  subcategory: Maybe<Subcategory>;
};

/** Relationship from Event -> Packet */
export type UsesPacketAtRound = {
  id: Scalars['ID']['output'];
  packet: Maybe<Packet>;
  round: Maybe<Scalars['Int']['output']>;
};
