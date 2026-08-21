export interface ModelltestListItemDto {
  id: string;
  number: number;
  title: string;
}

export interface ModelltestExercisesDto {
  sprachbausteineT1: string[];
  sprachbausteineT2: string[];
  lesenT1: string[];
  lesenT2: string[];
  lesenT3: string[];
  writing: string[];
  listening: string[];
  speaking: string[];
}

export interface ModelltestDetailDto extends ModelltestListItemDto {
  exercises: ModelltestExercisesDto;
}
