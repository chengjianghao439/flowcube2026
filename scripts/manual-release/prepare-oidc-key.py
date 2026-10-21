#!/usr/bin/env python3
"""Operator-side conversion of an independently verified public JWKS; never fetches."""
import base64
import json
from pathlib import Path
import re
import sys


def der(tag, data):
    size=len(data)
    length=bytes([size]) if size<128 else bytes([0x80+(size.bit_length()+7)//8])+size.to_bytes((size.bit_length()+7)//8,'big')
    return bytes([tag])+length+data


def integer(value):
    raw=base64.urlsafe_b64decode(value+'='*(-len(value)%4)).lstrip(b'\0')
    if not raw or raw[0]&0x80: raw=b'\0'+raw
    return der(2,raw)


def convert(jwks, output):
    output=Path(output);output.mkdir(mode=0o700,exist_ok=False)
    for key in jwks['keys']:
        if key.get('kty')!='RSA' or key.get('use')!='sig' or key.get('alg')!='RS256': continue
        kid=key['kid']
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',kid): raise ValueError('Invalid public key identifier')
        rsa=der(0x30,integer(key['n'])+integer(key['e']))
        algorithm=bytes.fromhex('300d06092a864886f70d0101010500')
        public=der(0x30,algorithm+der(3,b'\0'+rsa))
        encoded=base64.b64encode(public).decode()
        pem='-----BEGIN PUBLIC KEY-----\n'+'\n'.join(encoded[n:n+64] for n in range(0,len(encoded),64))+'\n-----END PUBLIC KEY-----\n'
        with (output/(kid+'.pem')).open('x') as target: target.write(pem)
    if not list(output.iterdir()): raise ValueError('No approved RS256 signature keys')


if __name__=='__main__':
    try:
        if len(sys.argv)!=3: raise ValueError()
        convert(json.loads(Path(sys.argv[1]).read_text()),sys.argv[2])
    except Exception:
        print('Public trust conversion failed; review local input and do not install partial output',file=sys.stderr);sys.exit(1)
