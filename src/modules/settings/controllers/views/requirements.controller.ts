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
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Portal } from '../../../authentication/decorators/portal.decorator';
import { RequirePermission } from '../../../authorization/decorators/require-permission.decorator';
import {
  AuthorizationLevel,
  MERCHANT_LEVELS,
  SetPermission,
} from '../../../authorization/entities/permission.entity';
import { RequirementInput } from '../../../onboarding/entities/requirement.entity';
import { RequirementService } from '../../../onboarding/services/requirement.service';
import { PORTALS } from '../../../shared/constants/portals';
import { FieldErrors, validateForm } from '../../../shared/utils/form.util';
import {
  fragment,
  pager,
  sectionView,
} from '../../../shared/utils/portal-view.util';
import { RequirementForm } from '../../dtos/settings-form.dtos';
import { CountryService } from '../../services/country.service';

const BASE = '/admin/settings/requirements';

const LEVEL_LABELS: Record<string, string> = {
  [AuthorizationLevel.B2B]: 'Merchant (B2B)',
  [AuthorizationLevel.WhiteLabel]: 'White-label merchant',
};

const INPUT_LABELS: Record<string, string> = {
  [RequirementInput.FILE]: 'Document upload',
  [RequirementInput.TEXT]: 'Text',
  [RequirementInput.NUMBER]: 'Number',
};

/**
 * What merchants must provide to be approved, per country and level. Edits
 * apply to new submissions; answers already given keep their snapshot.
 */
@ApiExcludeController()
@Controller('admin/settings/requirements')
@Portal(AuthorizationLevel.Staff)
@RequirePermission(SetPermission.StaffRequirementsManage)
export class RequirementsViewController {
  constructor(
    private readonly requirementService: RequirementService,
    private readonly countryService: CountryService,
  ) {}

  @Get()
  async page(
    @Req() req: Request,
    @Res() res: Response,
    @Query('q') q = '',
    @Query('country') country = '',
    @Query('level') level = '',
    @Query('page') page = '1',
  ) {
    const countries = await this.countryService.allOptions();
    return res.render(
      'pages/settings/requirements',
      sectionView(PORTALS.admin, req, 'settings', 'Onboarding requirements', {
        q,
        countries: countries.map((item) => ({
          id: item.id,
          name: item.name,
          selected: String(item.id) === country,
        })),
        levels: MERCHANT_LEVELS.map((value) => ({
          value,
          label: LEVEL_LABELS[value],
          selected: String(value) === level,
        })),
        hasCountries: countries.length > 0,
        ...(await this.table(q, country, level, Number(page))),
      }),
    );
  }

  @Get('table')
  async tableFragment(
    @Res() res: Response,
    @Query('q') q = '',
    @Query('country') country = '',
    @Query('level') level = '',
    @Query('page') page = '1',
  ) {
    return fragment(
      res,
      'settings/requirements_table',
      await this.table(q, country, level, Number(page)),
    );
  }

  @Get('new')
  async newForm(@Res() res: Response, @Query('country') country = '') {
    return fragment(
      res,
      'settings/requirement_form',
      await this.formContext(BASE, {
        country,
        level: AuthorizationLevel.B2B,
        input: RequirementInput.FILE,
        required: 'on',
      }),
    );
  }

  @Get(':id/edit')
  async editForm(@Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    const requirement = await this.requirementService.filter(
      { id },
      { relations: { country: true } },
    );
    if (!requirement)
      return res
        .status(404)
        .json({ ok: false, message: 'Requirement not found' });
    return fragment(
      res,
      'settings/requirement_form',
      await this.formContext(
        `${BASE}/${id}`,
        {
          ...requirement,
          country: requirement.country?.id,
          required: requirement.required ? 'on' : undefined,
        },
        {},
        true,
      ),
    );
  }

  @Post()
  create(@Res() res: Response, @Body() body: Record<string, unknown>) {
    return this.save(res, body);
  }

  @Post(':id')
  async update(
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
  ) {
    if (!(await this.requirementService.filter({ id })))
      return res
        .status(404)
        .json({ ok: false, message: 'Requirement not found' });
    return this.save(res, body, id);
  }

  @Post(':id/delete')
  async remove(@Res() res: Response, @Param('id', ParseIntPipe) id: number) {
    const requirement = await this.requirementService.filter({ id });
    if (!requirement)
      return res
        .status(404)
        .json({ ok: false, message: 'Requirement not found' });
    await this.requirementService.delete({ id });
    return res.json({ ok: true, message: `${requirement.name} deleted` });
  }

  /* --------------------------- Helpers ----------------------------- */

  private async save(
    res: Response,
    body: Record<string, unknown>,
    id?: number,
  ) {
    const { values, errors } = await validateForm(RequirementForm, body);
    if (
      !errors.country &&
      !(await this.countryService.filter({ id: values.country }))
    )
      errors.country = 'Choose a country from the list';
    if (Object.keys(errors).length)
      return fragment(
        res,
        'settings/requirement_form',
        await this.formContext(id ? `${BASE}/${id}` : BASE, body, errors, !!id),
        422,
      );
    const requirement = await this.requirementService.saveForm(values, id);
    return res.json({
      ok: true,
      message: `${requirement.name} ${id ? 'updated' : 'added'}`,
    });
  }

  private async formContext(
    action: string,
    values: Record<string, unknown>,
    errors: FieldErrors = {},
    editing = false,
  ) {
    const countries = await this.countryService.allOptions();
    return {
      action,
      editing,
      values,
      errors,
      hasErrors: Object.keys(errors).length > 0,
      countries: countries.map((country) => ({
        id: country.id,
        name: country.active ? country.name : `${country.name} (inactive)`,
        selected: String(country.id) === String(values.country),
      })),
      levels: MERCHANT_LEVELS.map((value) => ({
        value,
        label: LEVEL_LABELS[value],
        selected: value === values.level,
      })),
      inputs: Object.values(RequirementInput).map((value) => ({
        value,
        label: INPUT_LABELS[value],
        selected: value === values.input,
      })),
    };
  }

  private async table(q: string, country: string, level: string, page: number) {
    const result = await this.requirementService.search(
      { q, country, level },
      page,
    );
    return {
      requirements: result.items.map((requirement) => ({
        id: requirement.id,
        name: requirement.name,
        comment: requirement.comment,
        required: requirement.required,
        country: requirement.country?.name ?? 'No country',
        countryFlag: requirement.country?.logo,
        level: LEVEL_LABELS[requirement.level] ?? requirement.level,
        input: INPUT_LABELS[requirement.input] ?? requirement.input,
      })),
      filtered: Boolean(q || country || level),
      ...pager(result, `${BASE}/table`, { q, country, level }),
    };
  }
}
