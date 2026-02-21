export class StudentResponseDto {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  isRegistered: boolean;
  createdAt: string;
  updatedAt: string;
}

export class BootstrapDto {
  availableModules: string[];
  enabledModules: string[];
  progressSummary: Record<string, number>;
  lastActivityAt: string | null;
  expiresAt: string;
}

export class ActivateResponseDto {
  accessToken: string;
  refreshToken: string;
  student: StudentResponseDto;
  bootstrap: BootstrapDto;
}
