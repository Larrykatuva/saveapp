import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Portal } from '../../../authentication/decorators/portal.decorator';
import { RequirePermission } from '../../../authorization/decorators/require-permission.decorator';
import {
  AuthorizationLevel,
  SetPermission,
} from '../../../authorization/entities/permission.entity';
import { PORTALS } from '../../../shared/constants/portals';
import {
  FieldErrors,
  FormError,
  validateForm,
} from '../../../shared/utils/form.util';
import {
  fragment,
  pager,
  sectionView,
} from '../../../shared/utils/portal-view.util';
import { CountryForm } from '../../dtos/settings-form.dtos';
import { CountryService, isUploaded } from '../../services/country.service';

const BASE = '/admin/settings/countries';

/** Single `logo` image per request; size and type are checked on upload. */
export const FLAG_UPLOAD = FileInterceptor('logo', {
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

const formContext = (
  values: Record<string, unknown>,
  errors: FieldErrors = {},
) => ({ values, errors, hasErrors: Object.keys(errors).length > 0 });

/** What the drawer shows for the image currently saved on a record. */
const logoContext = (logo?: string | null) => ({
  currentLogo: logo || null,
  customLogo: isUploaded(logo),
});

/** Countries SaveApp operates in; each has its own onboarding requirements. */
@ApiExcludeController()
@Controller('admin/settings/countries')
@Portal(AuthorizationLevel.Staff)
@RequirePermission(SetPermission.StaffCountriesManage)
export class CountriesViewController {
  constructor(private readonly countryService: CountryService) {}

  @Get()
  async page(
    @Req() req: Request,
    @Res() res: Response,
    @Query('q') q = '',
    @Query('page') page = '1',
  ) {
    return res.render(
      'pages/settings/countries',
      sectionView(PORTALS.admin, req, 'settings', 'Countries', {
        q,
        ...(await this.table(q, Number(page))),
      }),
    );
  }

  @Get('table')
  async tableFragment(
    @Res() res: Response,
    @Query('q') q = '',
    @Query('page') page = '1',
  ) {
    return fragment(res, 'settings/countries_table', {
      q,
      ...(await this.table(q, Number(page))),
    });
  }

  @Get('new')
  newForm(@Res() res: Response) {
    return fragment(res, 'settings/country_form', {
      action: BASE,
      ...logoContext(null),
      ...formContext({ active: 'on' }),
    });
  }

  @Get(':id/edit')
  async editForm(@Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    const country = await this.countryService.filter({ id });
    if (!country)
      return res.status(404).json({ ok: false, message: 'Country not found' });
    return fragment(res, 'settings/country_form', {
      action: `${BASE}/${id}`,
      editing: true,
      ...logoContext(country.logo),
      ...formContext({ ...country, active: country.active ? 'on' : undefined }),
    });
  }

  @Post()
  @UseInterceptors(FLAG_UPLOAD)
  create(
    @Res() res: Response,
    @Body() body: Record<string, unknown>,
    @UploadedFile() logo?: Express.Multer.File,
  ) {
    return this.save(res, body, undefined, logo);
  }

  @Post(':id')
  @UseInterceptors(FLAG_UPLOAD)
  async update(
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
    @UploadedFile() logo?: Express.Multer.File,
  ) {
    if (!(await this.countryService.filter({ id })))
      return res.status(404).json({ ok: false, message: 'Country not found' });
    return this.save(res, body, id, logo);
  }

  @Post(':id/toggle')
  async toggle(@Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    const country = await this.countryService.filter({ id });
    if (!country)
      return res.status(404).json({ ok: false, message: 'Country not found' });
    await this.countryService.update({ id }, { active: !country.active });
    return res.json({
      ok: true,
      active: !country.active,
      message: `${country.name} ${country.active ? 'deactivated' : 'activated'}`,
    });
  }

  @Post(':id/delete')
  async remove(@Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    const country = await this.countryService.filter({ id });
    if (!country)
      return res.status(404).json({ ok: false, message: 'Country not found' });
    try {
      await this.countryService.remove(country);
      return res.json({ ok: true, message: `${country.name} deleted` });
    } catch (error) {
      if (error instanceof FormError)
        return res.status(409).json({ ok: false, message: error.message });
      throw error;
    }
  }

  /* --------------------------- Helpers ----------------------------- */

  private async save(
    res: Response,
    body: Record<string, unknown>,
    id?: number,
    logo?: Express.Multer.File,
  ) {
    const action = id ? `${BASE}/${id}` : BASE;
    const existing = id ? await this.countryService.filter({ id }) : null;
    const rerender = (errors: FieldErrors) =>
      fragment(
        res,
        'settings/country_form',
        {
          action,
          editing: Boolean(id),
          ...logoContext(existing?.logo),
          ...formContext(body, errors),
        },
        422,
      );
    const { values, errors } = await validateForm(CountryForm, body);
    if (Object.keys(errors).length) return rerender(errors);
    try {
      const country = await this.countryService.saveForm(values, id, logo);
      return res.json({
        ok: true,
        message: `${country.name} ${id ? 'updated' : 'added'}`,
      });
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      return rerender(error.errors);
    }
  }

  private async table(q: string, page: number) {
    const result = await this.countryService.search(q, page);
    const usage = await this.countryService.usage(
      result.items.map((item) => item.id),
    );
    return {
      countries: result.items.map((country) => ({
        ...country,
        ...usage[country.id],
      })),
      ...pager(result, `${BASE}/table`, { q }),
    };
  }
}
