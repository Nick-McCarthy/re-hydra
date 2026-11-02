#ifndef SAMPLE_TYPES_H
#define SAMPLE_TYPES_H

struct Header {
  int length;
  int flags;
};

int skip_space(const char *p);
int header_size(const struct Header *h);
int parse_header(const struct Header *h, const char *p);

#endif
