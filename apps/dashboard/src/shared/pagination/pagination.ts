import { ApiProperty } from '@nestjs/swagger';

export class PaginationDto {
  constructor(pagination: PaginationDto) {
    Object.assign(this, pagination);
  }

  @ApiProperty()
  size: number;

  @ApiProperty()
  totalCount: number;

  @ApiProperty()
  currentPage: number;

  @ApiProperty({ required: false, nullable: true })
  previousPage: number | null;

  @ApiProperty({ required: false, nullable: true })
  nextPage: number | null;

  @ApiProperty()
  totalPage: number;
}

export interface Pageable {
  page: number;
  size: number;
}

export class Page<T> {
  readonly data: T[];
  readonly pagination: PaginationDto;

  constructor({
    pageable,
    total,
    data,
  }: {
    pageable: Pageable;
    total: number;
    data: T[];
  }) {
    this.data = data;
    this.pagination = paginator({ pageable, total });
  }
}

const paginator = ({
  pageable,
  total,
}: {
  pageable: Pageable;
  total: number;
}): PaginationDto => {
  const { page, size } = pageable;
  const totalPage = Math.ceil(total / size);

  return new PaginationDto({
    size,
    totalCount: total,
    currentPage: page,
    previousPage: page > 1 ? page - 1 : null,
    nextPage: page < totalPage ? page + 1 : null,
    totalPage,
  });
};

/** Translates a Pageable into Prisma's `take` / `skip`. */
export const paging = (pageable: Pageable): { take: number; skip: number } => {
  const { page, size } = pageable;
  const skip = page <= 0 ? 0 : size * (page - 1);

  return { take: size, skip };
};
