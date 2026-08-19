import { PrismaClient } from '@config/prisma';
import { logSeeded } from './seed.helper';

/**
 * MANDATORY - production data.
 *
 * Indonesian bank catalogue. Every merchant and agent carries a bankCode, and
 * the dashboard's `common/div?div=BANK` dropdown reads this table, so it has to
 * exist before anyone can be onboarded.
 *
 * `Bank.code` is the primary key. The legacy list contained six duplicate codes
 * and would have thrown P2002 partway through; the duplicates were resolved by
 * hand (renames collapsed to one entry, and Bank NTB / Bank SulutGo split across
 * 127 / 128). This file is that resolved list - 91 banks, all codes distinct.
 *
 * Upserts on the code, so re-running is safe and never rewrites a name that was
 * corrected in the database.
 */
const BANKS: { code: string; name: string }[] = [
  // Bank Umum Nasional (30)
  { code: '014', name: 'BCA' },
  { code: '008', name: 'MANDIRI' },
  { code: '009', name: 'BNI' },
  { code: '002', name: 'BRI' },
  { code: '200', name: 'BTN' },
  { code: '013', name: 'PERMATA' },
  { code: '011', name: 'DANAMON' },
  { code: '016', name: 'MAYBANK INDONESIA' },
  { code: '426', name: 'MEGA' },
  { code: '153', name: 'SINARMAS' },
  { code: '028', name: 'OCBC NISP' },
  { code: '441', name: 'BUKOPIN (KB BUKOPIN)' },
  { code: '019', name: 'PANIN' },
  { code: '213', name: 'BTPN / Jenius' },
  { code: '950', name: 'COMMONWEALTH' },
  { code: '023', name: 'UOB INDONESIA' },
  { code: '054', name: 'CAPITAL INDONESIA' },
  { code: '097', name: 'MAYAPADA' },
  { code: '157', name: 'MASPION' },
  { code: '161', name: 'GANESHA' },
  { code: '212', name: 'WOORI SAUDARA' },
  { code: '095', name: 'JTRUST' },
  { code: '566', name: 'VICTORIA INTERNATIONAL' },
  { code: '523', name: 'SAHABAT SAMPOERNA' },
  { code: '555', name: 'INDEX SELINDO' },
  { code: '503', name: 'NOBU (NATIONAL NOBU)' },
  { code: '513', name: 'INA PERDANA' },
  { code: '553', name: 'MAYORA INDONESIA' },
  { code: '485', name: 'MNC INTERNASIONAL' },
  { code: '567', name: 'HARDA INTERNASIONAL' },

  // Bank Digital / Fintech (7)
  { code: '501', name: 'blu by BCA Digital' },
  { code: '535', name: 'Seabank' },
  { code: '542', name: 'Bank Jago' },
  { code: '490', name: 'Bank Neo Commerce' },
  { code: '484', name: 'Line Bank' },
  { code: '562', name: 'Superbank' },
  { code: '947', name: 'Bank Aladin Syariah' },

  // Bank Syariah (10)
  { code: '451', name: 'Bank Suariah Indonesia (BSI)' },
  { code: '147', name: 'Bank Muamalat' },
  { code: '536', name: 'BCA Syariah' },
  { code: '547', name: 'BTPN Syariah' },
  { code: '521', name: 'KB Bukopin Syariah' },
  { code: '022', name: 'CIMB Niaga Syariah' },
  { code: '425', name: 'Bank BJB Syariah' },
  { code: '517', name: 'Bank Panin Dubai Syariah' },
  { code: '506', name: 'Bank Mega Syariah' },
  { code: '116', name: 'BPD Aceh Suariah' },

  // Bank Pembangunan Daerah (26)
  { code: '110', name: 'Bank BJB' },
  { code: '111', name: 'Bank DKI' },
  { code: '112', name: 'BPD DIY' },
  { code: '113', name: 'Bank Jateng' },
  { code: '114', name: 'Bank Jatim' },
  { code: '115', name: 'BPD Jambi' },
  { code: '117', name: 'Bank Sumut' },
  { code: '118', name: 'Bank Nagari (Sumbar)' },
  { code: '119', name: 'Bank Riau Kepri' },
  { code: '120', name: 'Bank Sumsel Babel' },
  { code: '121', name: 'Bank Lampung' },
  { code: '122', name: 'Bank Kalsel' },
  { code: '123', name: 'Bank Kalbar' },
  { code: '124', name: 'Bank Kaltimtara' },
  { code: '125', name: 'Bank Kalteng' },
  { code: '126', name: 'Bank Sulselbar' },
  { code: '128', name: 'Bank SulutGo' },
  { code: '127', name: 'Bank NTB' },
  { code: '129', name: 'BPD Bali' },
  { code: '130', name: 'Bank NTT' },
  { code: '131', name: 'Bank Muluku Malut' },
  { code: '132', name: 'Bank Papua' },
  { code: '133', name: 'Bank Bengkulu' },
  { code: '134', name: 'Bank Sulteng' },
  { code: '135', name: 'Bank Sultra' },
  { code: '137', name: 'Bank Banten' },

  // Bank Asing (18)
  { code: '041', name: 'HSBC' },
  { code: '050', name: 'Standart Chartered' },
  { code: '032', name: 'JP Morgan Chase' },
  { code: '033', name: 'Bank of America' },
  { code: '046', name: 'DBS Indonesia' },
  { code: '069', name: 'Bank of China' },
  { code: '048', name: 'Mizuho Bank' },
  { code: '042', name: 'MUFG Bank' },
  { code: '061', name: 'ANZ Indonesia' },
  { code: '067', name: 'Deutsche Bank' },
  { code: '057', name: 'BNP Paribas' },
  { code: '040', name: 'Bangkok Bank' },
  { code: '036', name: 'China Construction Bank (CCB)' },
  { code: '164', name: 'ICBC Indonesia' },
  { code: '047', name: 'Resona Perdania' },
  { code: '039', name: 'Credit Agricole Indosuez' },
  { code: '949', name: 'CTBC Indonesia' },
  { code: '059', name: 'Korea Exchane Bank' },
];

export async function bankEngineSeed(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(
    BANKS.map((bank) =>
      prisma.bank.upsert({
        where: { code: bank.code },
        create: bank,
        update: {},
        select: { code: true },
      }),
    ),
  );

  logSeeded('banks', BANKS.length);
}
