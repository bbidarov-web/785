export interface WalkListItemDto {
  planId: string;
  no: string;
  name: string;
  object: string;
  branch: string;
  kind: string;
  owner: string;
  planDate: string;
  noCheck: boolean;
  noCheckNote: string;
  answered: number;
  total: number;
  bad: number;
  pct: number;
  finished: boolean;
  status: string;
}

export interface WalkItemAnswerDto {
  index: number;
  text: string;
  answer: '' | 'ok' | 'bad';
  comment: string;
  hasPhoto: boolean;
  photoFileId: string | null;
}

export interface WalkDetailDto extends WalkListItemDto {
  items: WalkItemAnswerDto[];
}
