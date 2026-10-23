from pydantic import BaseModel

from APP.constants import EmailMessageType, Locale


class EmailMessage(BaseModel):
    type: EmailMessageType
    to_email: str
    to_name: str
    data: dict
    # Язык письма; консьюмер без этого поля считает письмо русским.
    locale: Locale = Locale.RU
