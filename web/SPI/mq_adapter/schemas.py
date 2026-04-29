from pydantic import BaseModel

from APP.constants import EmailMessageType


class EmailMessage(BaseModel):
    type: EmailMessageType
    to_email: str
    to_name: str
    data: dict
